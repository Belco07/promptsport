import { Prisma } from "@/generated/prisma/client";
import { generateArticleFromAlert, isAiConfigured } from "@/lib/ai";
import { withDatabaseRetry } from "@/lib/database-retry";
import {
  AI_QUOTA_MESSAGE,
  countAiDraftsToday,
  getAiDraftQuota,
  maxDailyAiDrafts,
  sourceAllowsImageUse,
  sourceCanAutoPublish,
} from "@/lib/news-automation";
import { createNewsCover } from "@/lib/news-cover";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

/**
 * Génération éditoriale depuis une alerte de veille (WP49).
 *
 * Ce module est partagé par le backoffice (Server Action) et le pipeline
 * automatique des alertes 5 🔥 (cron de collecte). Il ne dépend d'aucune
 * session : l'appelant fournit l'auteur.
 *
 * Règles :
 *  - toute alerte en attente peut être générée manuellement, quel que soit son
 *    score de viralité ;
 *  - seules les alertes 5 🔥 peuvent être publiées automatiquement, et seulement
 *    si la source a activé `autoPublish` avec une fiabilité >= 95 ;
 *  - un visuel source `LICENSED` est repris tel quel (recadré, sans habillage) ;
 *  - un visuel non licencié est édité avec titre, logo et dégradé de lisibilité ;
 *  - sans aucun visuel exploitable, l'article reste un brouillon publiable
 *    manuellement depuis le studio, avec confirmation explicite.
 */

export type NewsGenerationResult = {
  success: boolean;
  message: string;
  articleId?: string;
  published?: boolean;
  /** Publication automatique bloquée faute de visuel exploitable. */
  photoBlocked?: boolean;
  format?: "FLASH" | "NEWS" | "ANALYSIS";
};

class AiQuotaExceededError extends Error {
  constructor() {
    super(AI_QUOTA_MESSAGE);
    this.name = "AiQuotaExceededError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** Catégorie par défaut : Football si elle existe, sinon la première créée. */
async function defaultCategoryId(): Promise<string | null> {
  const football = await prisma.category.findFirst({
    where: { slug: "football" },
    select: { id: true },
  });
  if (football) return football.id;

  const first = await prisma.category.findFirst({
    orderBy: { name: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Crée l'article issu de l'IA, avec un slug unique et le statut décidé. */
async function createArticleFromAlert(input: {
  title: string;
  excerpt: string;
  content: string;
  format: "FLASH" | "NEWS" | "ANALYSIS";
  categoryId: string;
  authorId: string;
  alertId: string;
  newsSourceId: string;
  socialAutoPublish: boolean;
  status: "DRAFT" | "PUBLISHED";
  publishedAt: Date | null;
  coverImageUrl: string | null;
  coverImageCredit: string | null;
  coverImageCreditUrl: string | null;
  themeId?: string;
}): Promise<{ articleId: string; published: boolean }> {
  const base = slugify(input.title).slice(0, 90) || `article-${Date.now()}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const article = await withDatabaseRetry(() =>
        prisma.$transaction(
          async (tx) => {
            const limit = maxDailyAiDrafts();
            const used = await countAiDraftsToday(new Date(), tx);
            if (used >= limit) throw new AiQuotaExceededError();

            const claimed = await tx.newsAlert.updateMany({
              where: { id: input.alertId, status: "PENDING" },
              data: { status: "DRAFT_GENERATED" },
            });
            if (claimed.count !== 1) throw new Error("Alerte déjà traitée.");
            const created = await tx.article.create({
              data: {
                title: input.title,
                slug,
                content: input.content,
                excerpt: input.excerpt,
                status: input.status,
                format: input.format,
                isPremium: false,
                publishedAt: input.publishedAt,
                coverImageUrl: input.coverImageUrl,
                coverImageCredit: input.coverImageCredit,
                coverImageCreditUrl: input.coverImageCreditUrl,
                authorId: input.authorId,
                categoryId: input.categoryId,
                newsSourceId: input.newsSourceId,
                socialAutoPublish: input.socialAutoPublish,
                ...(input.themeId
                  ? { themes: { connect: { id: input.themeId } } }
                  : {}),
              },
              select: { id: true },
            });

            await tx.newsAlert.update({
              where: { id: input.alertId },
              data: { status: "DRAFT_GENERATED" },
            });

            return created;
          },
          { maxWait: 10_000, timeout: 20_000 },
        ),
      );

      return { articleId: article.id, published: input.status === "PUBLISHED" };
    } catch (error) {
      if (error instanceof AiQuotaExceededError) throw error;
      if (isUniqueConstraintError(error) && attempt < 4) continue;
      throw error;
    }
  }

  throw new Error("Impossible de générer un slug unique pour cet article.");
}

/**
 * Génère un article à partir d'une alerte, quel que soit son score.
 *
 * L'alerte n'est marquée DRAFT_GENERATED qu'après la création réussie de
 * l'article : un échec de l'IA la laisse en PENDING pour une nouvelle tentative.
 */
export async function generateNewsArticle(input: {
  alertId: string;
  authorId: string;
}): Promise<NewsGenerationResult> {
  const { alertId, authorId } = input;
  if (!isAiConfigured()) {
    return { success: false, message: "Clé IA absente." };
  }

  try {
    const alert = await prisma.newsAlert.findUnique({
      where: { id: alertId },
      include: {
        source: {
          select: {
            id: true,
            name: true,
            isOfficial: true,
            reliability: true,
            autoPublish: true,
            imagePolicy: true,
          },
        },
      },
    });
    if (!alert || alert.status !== "PENDING") {
      return { success: false, message: "Cette alerte a déjà été traitée ou supprimée." };
    }

    const quota = await getAiDraftQuota();
    if (quota.remaining <= 0) return { success: false, message: AI_QUOTA_MESSAGE };

    const [categories, themes] = await Promise.all([
      prisma.category.findMany({ select: { id: true, slug: true, name: true } }),
      prisma.theme.findMany({ select: { id: true, slug: true, name: true } }),
    ]);
    if (!categories.length) {
      return { success: false, message: "Créez une catégorie avant de générer un article." };
    }

    const licensed = sourceAllowsImageUse(alert.source);
    const generated = await generateArticleFromAlert({
      title: alert.titleFr ?? alert.title,
      originalTitle: alert.title,
      titleFr: alert.titleFr,
      content: alert.content,
      url: alert.url,
      sourceName: alert.source.name,
      publishedAt: alert.publishedAt,
      categories,
      themes,
      viralScore: alert.viralScore,
      imageCredit: alert.imageCredit,
      imageLicensed: licensed,
      isOfficial: alert.source.isOfficial,
    });

    const categoryId =
      categories.find((category) => category.slug === generated.categorySlug)?.id ??
      (await defaultCategoryId());
    if (!categoryId) return { success: false, message: "Aucune catégorie disponible." };
    const themeId = themes.find((theme) => theme.slug === generated.themeSlug)?.id;
    const categoryName =
      categories.find((category) => category.id === categoryId)?.name ?? "Sport";

    // Politique visuel WP49 : le visuel licencié est conservé tel quel, le
    // visuel non licencié est brandé (titre + logo + dégradé). Sans visuel,
    // l'article reste un brouillon publiable manuellement.
    const cover = await createNewsCover({
      title: generated.title,
      category: categoryName,
      imageUrl: alert.imageUrl,
      imageCredit: alert.imageCredit,
      articleUrl: alert.url,
      sourceName: alert.source.name,
      licensed,
    });

    // La publication automatique reste réservée aux 5 🔥 d'une source
    // explicitement autorisée et fiable à 95/100.
    const autoPublishEligible =
      alert.viralScore === 5 && sourceCanAutoPublish(alert.source);
    const autoPublish = autoPublishEligible && cover !== null;
    const photoBlocked = autoPublishEligible && cover === null;

    const result = await createArticleFromAlert({
      ...generated,
      categoryId,
      themeId,
      authorId,
      alertId,
      newsSourceId: alert.source.id,
      socialAutoPublish: alert.source.isOfficial,
      status: autoPublish ? "PUBLISHED" : "DRAFT",
      publishedAt: autoPublish ? new Date() : null,
      coverImageUrl: cover?.url ?? null,
      coverImageCredit: cover?.credit ?? null,
      coverImageCreditUrl: cover?.creditUrl ?? null,
    });

    return {
      success: true,
      message: result.published
        ? "Article généré et publié automatiquement."
        : photoBlocked
          ? "Brouillon généré — sans photo source exploitable : publication automatique impossible."
          : "Brouillon généré",
      articleId: result.articleId,
      published: result.published,
      photoBlocked,
      format: generated.format,
    };
  } catch (error) {
    if (error instanceof AiQuotaExceededError) {
      return { success: false, message: AI_QUOTA_MESSAGE };
    }
    console.error(
      "[veille] génération interrompue :",
      error instanceof Error ? error.message : "Erreur inconnue",
    );
    return {
      success: false,
      message:
        "La génération a échoué. Actualisez la veille et réessayez les alertes encore en attente.",
    };
  }
}

export type AutoGenerationResult = {
  generated: number;
  published: number;
  failed: number;
  /** Aucune génération possible, avec la raison associée. */
  reason?: "ai_disabled" | "quota_exhausted" | "no_author";
};

/**
 * Pipeline automatique des alertes 5 🔥.
 *
 * Appelé après une collecte (cron ou actualisation manuelle). Les articles sont
 * générés dans la limite du quota quotidien ; la publication reste soumise aux
 * garde-fous de la source. Les brouillons sans visuel sont conservés pour une
 * publication manuelle confirmée.
 */
export async function autoGenerateViralAlerts(
  options: { limit?: number } = {},
): Promise<AutoGenerationResult> {
  if (!isAiConfigured()) {
    return { generated: 0, published: 0, failed: 0, reason: "ai_disabled" };
  }

  const quota = await getAiDraftQuota();
  if (quota.remaining <= 0) {
    return { generated: 0, published: 0, failed: 0, reason: "quota_exhausted" };
  }

  const requested = options.limit ?? 5;
  const safeRequested = Number.isFinite(requested) ? Math.floor(requested) : 5;
  const take = Math.max(0, Math.min(safeRequested, quota.remaining));
  if (take === 0) {
    return { generated: 0, published: 0, failed: 0, reason: "quota_exhausted" };
  }

  const author = await prisma.author.findFirst({
    where: {
      role: { in: ["ADMIN", "EDITOR"] },
      ...(process.env.NEWS_AUTO_AUTHOR_ID?.trim()
        ? { id: process.env.NEWS_AUTO_AUTHOR_ID.trim() }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!author) {
    return { generated: 0, published: 0, failed: 0, reason: "no_author" };
  }

  const alerts = await prisma.newsAlert.findMany({
    where: {
      status: "PENDING",
      viralScore: 5,
      source: { active: true },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take,
    select: { id: true },
  });

  let generated = 0;
  let published = 0;
  let failed = 0;
  for (const alert of alerts) {
    const result = await generateNewsArticle({
      alertId: alert.id,
      authorId: author.id,
    });
    if (!result.success) {
      failed += 1;
      continue;
    }
    generated += 1;
    if (result.published) published += 1;
  }

  return { generated, published, failed };
}
