"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import {
  generateArticleFromAlert,
  isAiConfigured,
  translateTitlesToFrench,
} from "@/lib/ai";
import { auth } from "@/lib/auth";
import { withDatabaseRetry } from "@/lib/database-retry";
import { prisma } from "@/lib/prisma";
import {
  AI_QUOTA_MESSAGE,
  AUTO_PUBLISH_RELIABILITY,
  countAiDraftsToday,
  getAiDraftQuota,
  maxDailyAiDrafts,
  sourceAllowsImageUse,
  sourceCanAutoPublish,
} from "@/lib/news-automation";
import { createNewsCover } from "@/lib/news-cover";
import { canAccessBackoffice } from "@/lib/roles";
import { slugify } from "@/lib/slug";
import {
  facebookPageFromUrl,
  instagramUsernameFromUrl,
  xHandleFromUrl,
} from "@/lib/social-platforms";

/**
 * Server Actions du News Engine (WP41, WP47).
 *
 * L'IA produit un article à partir d'une alerte virale (5/5), dans la limite
 * du quota quotidien. L'article reste en DRAFT, sauf si sa source est
 * explicitement autorisée à publier automatiquement et atteint le seuil de
 * fiabilité de 95/100. Toute autre publication reste une décision humaine.
 */

function veilUrl(params: { error?: string; info?: string; refreshed?: boolean } = {}): string {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error.slice(0, 300));
  if (params.info) search.set("info", params.info.slice(0, 300));
  if (params.refreshed) search.set("refreshed", "1");
  const query = search.toString();
  return `/backoffice/veille${query ? `?${query}` : ""}`;
}

function sourcesUrl(params: { error?: string; info?: string } = {}): string {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error.slice(0, 300));
  if (params.info) search.set("info", params.info.slice(0, 300));
  const query = search.toString();
  return `/backoffice/veille/sources${query ? `?${query}` : ""}`;
}

function fail(
  message: string,
  target: "veille" | "sources" = "veille",
): never {
  redirect(
    target === "sources"
      ? sourcesUrl({ error: message })
      : veilUrl({ error: message }),
  );
}

function failSource(message: string): never {
  fail(message, "sources");
}

/** Vérifie la session et le rôle avant toute génération. */
async function requireBackofficeUser(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!canAccessBackoffice(session.user.role)) redirect("/mon-compte");
  return { id: session.user.id };
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export type GenerateArticleResult = { articleId: string; published: boolean };

class AiQuotaExceededError extends Error {
  constructor() {
    super(AI_QUOTA_MESSAGE);
    this.name = "AiQuotaExceededError";
  }
}

/** Crée l'article issu de l'IA, avec un slug unique et le statut décidé. */
async function createArticleFromAlert(input: {
  title: string;
  excerpt: string;
  content: string;
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
}): Promise<GenerateArticleResult> {
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
                format: "NEWS",
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
 * Génère un article à partir d'une alerte.
 *
 * Seules les alertes 5/5 déclenchent l'IA, dans la limite du quota quotidien.
 * La publication est automatique uniquement si la source a opté pour
 * `autoPublish` et atteint 95/100 de fiabilité. L'alerte n'est marquée
 * DRAFT_GENERATED qu'après la création réussie de l'article : un échec de l'IA
 * la laisse en PENDING pour une nouvelle tentative.
 */
export type AlertActionResult = {
  success: boolean;
  message: string;
  articleId?: string;
  published?: boolean;
  /** Publication automatique bloquée faute de photo source exploitable. */
  photoBlocked?: boolean;
};

export async function generateArticle(alertId: string): Promise<AlertActionResult> {
  const user = await requireBackofficeUser();
  if (typeof alertId !== "string" || !alertId || alertId.length > 200) return { success: false, message: "Alerte introuvable." };
  if (!isAiConfigured()) return { success: false, message: "Clé IA absente." };
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
    if (!alert || alert.status !== "PENDING") return { success: false, message: "Cette alerte a déjà été traitée ou supprimée." };
    if (alert.viralScore !== 5) return { success: false, message: "Seules les alertes 5 🔥 peuvent déclencher une génération IA." };

    const quota = await getAiDraftQuota();
    if (quota.remaining <= 0) return { success: false, message: AI_QUOTA_MESSAGE };

    const [categories, themes] = await Promise.all([
      prisma.category.findMany({ select: { id: true, slug: true, name: true } }),
      prisma.theme.findMany({ select: { id: true, slug: true, name: true } }),
    ]);
    if (!categories.length) return { success: false, message: "Créez une catégorie avant de générer un article." };
    const generated = await generateArticleFromAlert({ title: alert.titleFr ?? alert.title, content: alert.content, url: alert.url, sourceName: alert.source.name, publishedAt: alert.publishedAt, categories, themes });
    const categoryId = categories.find(category => category.slug === generated.categorySlug)?.id ?? await defaultCategoryId();
    if (!categoryId) return { success: false, message: "Aucune catégorie disponible." };
    const themeId = themes.find(theme => theme.slug === generated.themeSlug)?.id;
    const autoPublishAllowed = sourceCanAutoPublish(alert.source);

    // La photo n'est reprise que si la source est explicitement licenciée.
    // Sans photo exploitable, l'article reste un brouillon : il ne peut pas être
    // publié, ni automatiquement ni manuellement, sans couverture.
    const cover = sourceAllowsImageUse(alert.source)
      ? await createNewsCover({
          title: generated.title,
          category:
            categories.find((category) => category.id === categoryId)?.name ?? "Sport",
          imageUrl: alert.imageUrl,
          imageCredit: alert.imageCredit,
          articleUrl: alert.url,
          sourceName: alert.source.name,
        })
      : null;

    const autoPublish = autoPublishAllowed && cover !== null;
    const photoBlocked = autoPublishAllowed && cover === null;
    const result = await createArticleFromAlert({
      ...generated,
      categoryId,
      themeId,
      authorId: user.id,
      alertId,
      newsSourceId: alert.source.id,
      socialAutoPublish: alert.source.isOfficial,
      status: autoPublish ? "PUBLISHED" : "DRAFT",
      publishedAt: autoPublish ? new Date() : null,
      coverImageUrl: cover?.url ?? null,
      coverImageCredit: cover?.credit ?? null,
      coverImageCreditUrl: cover?.creditUrl ?? null,
    });
    revalidatePath("/backoffice/veille");
    revalidatePath("/studio/articles");
    if (result.published) {
      revalidatePath("/");
      revalidatePath("/sitemap.xml");
      revalidatePath("/rss.xml");
    }
    return {
      success: true,
      message: result.published
        ? "Article généré et publié automatiquement."
        : photoBlocked
          ? "Brouillon généré — ajoutez une photo de couverture pour publier."
          : "Brouillon généré",
      articleId: result.articleId,
      published: result.published,
      photoBlocked,
    };
  } catch (error) {
    if (error instanceof AiQuotaExceededError) {
      return { success: false, message: AI_QUOTA_MESSAGE };
    }
    console.error("[veille] génération interrompue :", error instanceof Error ? error.message : "Erreur inconnue");
    return { success: false, message: "La génération a échoué. Actualisez la veille et réessayez les alertes encore en attente." };
  }
}

export async function ignoreSelectedAlert(alertId: string): Promise<AlertActionResult> {
  await requireBackofficeUser();
  if (typeof alertId !== "string" || !alertId || alertId.length > 200) return { success: false, message: "Alerte introuvable." };
  try {
    const result = await prisma.newsAlert.deleteMany({ where: { id: alertId, status: "PENDING" } });
    revalidatePath("/backoffice/veille");
    revalidatePath("/backoffice/veille/sources");
    return { success: result.count > 0, message: result.count ? "Alerte ignorée et supprimée." : "Alerte déjà traitée ou supprimée." };
  } catch { return { success: false, message: "La suppression a échoué." }; }
}

/**
 * Marque une sélection d'alertes comme virales (5/5).
 *
 * Le score est normalement calculé à la collecte. Cette action permet à la
 * rédaction de rattraper un sujet important que le calcul automatique n'a pas
 * assez valorisé, avant d'utiliser le nettoyage des alertes non virales.
 */
export async function markAlertsViral(alertIds: string[]): Promise<AlertActionResult> {
  await requireBackofficeUser();
  if (!Array.isArray(alertIds)) return { success: false, message: "Sélection invalide." };
  const ids = [...new Set(alertIds)]
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200)
    .slice(0, 200);
  if (!ids.length) return { success: false, message: "Aucune alerte sélectionnée." };
  try {
    const result = await prisma.newsAlert.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { viralScore: 5 },
    });
    revalidatePath("/backoffice/veille");
    return {
      success: result.count > 0,
      message: result.count
        ? `${result.count} alerte(s) marquée(s) 5 🔥.`
        : "Aucune alerte en attente n'a été mise à jour.",
    };
  } catch {
    return { success: false, message: "Le marquage des alertes a échoué." };
  }
}

/**
 * Supprime toutes les alertes dont le score est inférieur à 5.
 *
 * Les articles déjà générés ne sont pas concernés : seul le résultat de veille
 * disparaît. L'action est volontairement globale, pour vider rapidement le
 * bruit après avoir marqué les sujets à traiter.
 */
export async function cleanupNonViralAlerts(): Promise<void> {
  await requireBackofficeUser();
  const deleted = await withDatabaseRetry(() =>
    prisma.newsAlert.deleteMany({
      where: { viralScore: { lt: 5 } },
    }),
  );
  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  redirect(
    veilUrl({
      info: deleted.count
        ? `${deleted.count} alerte(s) non virale(s) supprimée(s). Les articles déjà générés sont conservés.`
        : "Aucune alerte non virale à supprimer.",
    }),
  );
}

/**
 * Ignore une alerte en la supprimant immédiatement et définitivement.
 *
 * Aucun statut « ignoré » n'est conservé : la veille ne doit pas accumuler de
 * lignes inutiles. Les brouillons éventuellement créés restent indépendants.
 */
export async function ignoreAlert(alertId: string): Promise<void> {
  await requireBackofficeUser();

  if (typeof alertId !== "string" || !alertId) {
    fail("Alerte introuvable.");
  }

  const deleted = await prisma.newsAlert.deleteMany({
    where: { id: alertId, status: "PENDING" },
  });

  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  redirect(
    veilUrl({
      info: deleted.count
        ? "Alerte supprimée définitivement."
        : "Cette alerte a déjà été traitée ou supprimée.",
    }),
  );
}

const SOURCE_TYPES = [
  "RSS",
  "YOUTUBE",
  "BLUESKY",
  "MASTODON",
  "REDDIT",
  "X",
  "FACEBOOK",
  "INSTAGRAM",
  "SOCIAL",
  "FLASHSCORE",
  "SITEMAP",
  "OFFICIAL_SITE",
  "JSON",
  "MANUAL",
] as const;

type SourceTypeValue = (typeof SOURCE_TYPES)[number];

function isSourceType(value: string): value is SourceTypeValue {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Lit la fiabilité saisie dans le formulaire (0 à 100). */
function readReliability(formData: FormData): number {
  const raw = readFormString(formData, "reliability");
  if (!raw) return 50;
  const reliability = Number(raw);
  if (!Number.isInteger(reliability) || reliability < 0 || reliability > 100) {
    failSource("La fiabilité doit être un entier compris entre 0 et 100.");
  }
  return reliability;
}

/**
 * Lit le droit photo de la source. Toute valeur inconnue retombe sur le mode
 * le plus protecteur : aucune reprise sans autorisation explicite.
 */
function readImagePolicy(formData: FormData): "REFERENCE_ONLY" | "LICENSED" {
  return readFormString(formData, "imagePolicy") === "LICENSED"
    ? "LICENSED"
    : "REFERENCE_ONLY";
}

function normalizeSourceUrl(raw: string, type: SourceTypeValue): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    failSource("URL invalide : indiquez une adresse HTTP(S) complète.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    failSource("URL invalide : seules les adresses HTTP(S) sont acceptées.");
  }

  const host = url.hostname.replace(/^www\./i, "");
  switch (type) {
    case "YOUTUBE":
      if (
        host !== "youtube.com" &&
        !host.endsWith(".youtube.com")
      ) {
        failSource("URL YouTube invalide : utilisez une URL de chaîne youtube.com.");
      }
      if (!url.pathname.startsWith("/@") && !url.pathname.startsWith("/channel/")) {
        failSource("URL YouTube invalide : utilisez /@handle ou /channel/UC….");
      }
      break;
    case "BLUESKY":
      if (host !== "bsky.app" || !url.pathname.startsWith("/profile/")) {
        failSource("URL Bluesky invalide : utilisez https://bsky.app/profile/….");
      }
      break;
    case "MASTODON": {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "users" && !parts[0]?.startsWith("@")) {
        failSource("URL Mastodon invalide : utilisez https://instance.social/@compte.");
      }
      break;
    }
    case "REDDIT":
      if (host !== "reddit.com" && !host.endsWith(".reddit.com")) {
        failSource("URL Reddit invalide : utilisez https://www.reddit.com/r/….");
      }
      if (!url.pathname.startsWith("/r/") && !url.pathname.startsWith("/user/")) {
        failSource("URL Reddit invalide : utilisez un subreddit /r/… ou un profil /user/….");
      }
      break;
    case "X":
      try {
        xHandleFromUrl(url.toString());
      } catch (error) {
        failSource(error instanceof Error ? error.message : "URL X invalide.");
      }
      break;
    case "FACEBOOK":
      try {
        facebookPageFromUrl(url.toString());
      } catch (error) {
        failSource(error instanceof Error ? error.message : "URL Facebook invalide.");
      }
      break;
    case "INSTAGRAM":
      try {
        instagramUsernameFromUrl(url.toString());
      } catch (error) {
        failSource(
          error instanceof Error ? error.message : "URL Instagram invalide.",
        );
      }
      break;
    case "RSS":
    case "SOCIAL":
    case "SITEMAP":
    case "OFFICIAL_SITE":
    case "JSON":
    case "MANUAL":
      break;
    case "FLASHSCORE":
      if (
        host !== "flashscore.fr" &&
        host !== "flashscore.com" &&
        !host.endsWith(".flashscore.fr") &&
        !host.endsWith(".flashscore.com")
      ) {
        failSource("URL Flashscore invalide : utilisez un domaine flashscore.fr ou flashscore.com.");
      }
      break;
  }

  return url;
}

/** Ajoute manuellement une source de veille. */
export async function addNewsSource(formData: FormData): Promise<void> {
  await requireBackofficeUser();

  const name = readFormString(formData, "name").slice(0, 120);
  const typeValue = readFormString(formData, "type");
  const rawUrl = readFormString(formData, "url");
  const isOfficial = formData.get("isOfficial") === "on";
  const reliability = readReliability(formData);
  const autoPublish = formData.get("autoPublish") === "on";
  const imagePolicy = readImagePolicy(formData);

  if (name.length < 2) {
    failSource("Le nom de la source doit contenir au moins 2 caractères.");
  }
  if (!isSourceType(typeValue)) {
    failSource("Type de source invalide.");
  }

  const url = normalizeSourceUrl(rawUrl, typeValue).toString();
  const accessReady: Partial<Record<SourceTypeValue, boolean>> = {
    X: Boolean(process.env.X_BEARER_TOKEN?.trim()),
    FACEBOOK: Boolean(process.env.META_ACCESS_TOKEN?.trim()),
    INSTAGRAM: Boolean(
      process.env.META_ACCESS_TOKEN?.trim() &&
        process.env.META_IG_USER_ID?.trim(),
    ),
    YOUTUBE: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
  };
  const active = accessReady[typeValue] ?? true;

  try {
    await prisma.newsSource.create({
      data: {
        name,
        type: typeValue,
        url,
        active,
        isOfficial,
        reliability,
        autoPublish,
        imagePolicy,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      failSource("Cette URL est déjà enregistrée comme source de veille.");
    }
    console.error(
      "[veille] échec de l'ajout de la source :",
      error instanceof Error ? error.message : error,
    );
    failSource("La source n'a pas pu être ajoutée.");
  }

  const autoPublishNote =
    autoPublish && reliability < AUTO_PUBLISH_RELIABILITY
      ? " La publication automatique attend une fiabilité d'au moins 95/100."
      : autoPublish && imagePolicy !== "LICENSED"
        ? " Photo source non autorisée : les articles resteront en brouillon."
        : "";
  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  redirect(
    sourcesUrl({
      info: active
        ? `Source « ${name} » ajoutée et activée.${autoPublishNote}`
        : `Source « ${name} » ajoutée ; sa collecte attend la configuration de l'accès API.${autoPublishNote}`,
    }),
  );
}

/** Supprime définitivement une source et toutes ses alertes (cascade). */
export async function deleteNewsSource(sourceId: string): Promise<void> {
  await requireBackofficeUser();

  if (typeof sourceId !== "string" || !sourceId) {
    failSource("Source introuvable.");
  }

  const source = await prisma.newsSource.findUnique({
    where: { id: sourceId },
    select: { name: true, _count: { select: { alerts: true } } },
  });
  if (!source) {
    failSource("Cette source n'existe plus.");
  }

  try {
    await prisma.newsSource.delete({ where: { id: sourceId } });
  } catch (error) {
    console.error(
      "[veille] échec de la suppression de la source :",
      error instanceof Error ? error.message : error,
    );
    failSource("La source n'a pas pu être supprimée.");
  }

  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  redirect(
    sourcesUrl({
      info: `Source « ${source.name} » supprimée définitivement avec ${source._count.alerts} alerte(s).`,
    }),
  );
}

/** Met à jour la fiabilité et l'autorisation de publication automatique. */
export async function updateNewsSourceAutomation(
  sourceId: string,
  formData: FormData,
): Promise<void> {
  await requireBackofficeUser();

  if (typeof sourceId !== "string" || !sourceId) {
    failSource("Source introuvable.");
  }
  const reliability = readReliability(formData);
  const autoPublish = formData.get("autoPublish") === "on";
  const imagePolicy = readImagePolicy(formData);

  const source = await prisma.newsSource.findUnique({
    where: { id: sourceId },
    select: { name: true },
  });
  if (!source) {
    failSource("Cette source n'existe plus.");
  }

  try {
    await prisma.newsSource.update({
      where: { id: sourceId },
      data: { reliability, autoPublish, imagePolicy },
    });
  } catch (error) {
    console.error(
      "[veille] échec de la mise à jour de l'automatisation :",
      error instanceof Error ? error.message : error,
    );
    failSource("L'automatisation de la source n'a pas pu être enregistrée.");
  }

  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  const info = autoPublish
    ? reliability >= AUTO_PUBLISH_RELIABILITY
      ? imagePolicy === "LICENSED"
        ? `Publication automatique activée pour « ${source.name} » (fiabilité ${reliability}/100, photo source autorisée).`
        : `Publication automatique armée pour « ${source.name} », mais photo source non autorisée : les articles resteront en brouillon.`
      : `Source « ${source.name} » enregistrée. La publication automatique restera inactive tant que la fiabilité est inférieure à ${AUTO_PUBLISH_RELIABILITY}/100.`
    : `Automatisation de « ${source.name} » enregistrée (fiabilité ${reliability}/100).`;
  redirect(sourcesUrl({ info }));
}

const TRANSLATION_BATCH_SIZE = 40;

/**
 * Traduit en français les titres des alertes qui n'ont pas encore de
 * traduction. Utilisé lorsque la collecte a été faite sans DEEPSEEK_API_KEY.
 */
export async function translateAlertTitles(): Promise<void> {
  await requireBackofficeUser();

  if (!isAiConfigured()) {
    fail(
      "Clé IA absente : renseignez DEEPSEEK_API_KEY dans .env et sur Vercel.",
    );
  }

  const alerts = await prisma.newsAlert.findMany({
    where: { titleFr: null },
    orderBy: { publishedAt: "desc" },
    take: TRANSLATION_BATCH_SIZE,
    select: { id: true, title: true },
  });

  if (alerts.length === 0) {
    redirect(veilUrl({ info: "Tous les titres de la veille sont déjà en français." }));
  }

  let translations: string[];
  try {
    translations = await translateTitlesToFrench(alerts.map((alert) => alert.title));
  } catch (error) {
    console.error(
      "[veille] échec de la traduction des titres :",
      error instanceof Error ? error.message : error,
    );
    fail("La traduction a échoué. Les titres restent inchangés ; réessayez plus tard.");
  }

  await prisma.$transaction(
    alerts.map((alert, index) =>
      prisma.newsAlert.update({
        where: { id: alert.id },
        data: { titleFr: translations[index]?.trim() || alert.title },
      }),
    ),
  );

  revalidatePath("/backoffice/veille");
  redirect(
    veilUrl({
      info: `${alerts.length} titre(s) traduit(s) en français.`,
    }),
  );
}

/** Réutilise le collecteur CLI/cron, après contrôle des droits côté serveur. */
export async function triggerManualFetch(): Promise<void> {
  await requireBackofficeUser();
  let result;
  try {
    const { fetchNews } = await import("@/lib/news-fetcher");
    result = await fetchNews({ concurrency: 3 });
  } catch {
    console.error("[veille] actualisation manuelle interrompue.");
    revalidatePath("/backoffice/veille");
    fail("La récupération a échoué. Réessayez dans quelques instants.");
  }
  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  if (result.sourcesProcessed > 0 && result.sourcesFailed === result.sourcesProcessed) {
    fail("Aucune source n’a pu être récupérée. Vérifiez la configuration des sources.");
  }
  const message = result.sourcesProcessed === 0
    ? "Aucune source active à récupérer."
    : result.alertsCreated + (result.alertsCreated === 1 ? " nouvelle alerte importée." : " nouvelles alertes importées.")
      + (result.sourcesFailed ? " " + result.sourcesFailed + " source(s) indisponible(s)." : "");
  redirect(veilUrl({ info: message, refreshed: true }));
}
