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
import { prisma } from "@/lib/prisma";
import { canAccessBackoffice } from "@/lib/roles";
import { slugify } from "@/lib/slug";
import {
  facebookPageFromUrl,
  instagramUsernameFromUrl,
  xHandleFromUrl,
} from "@/lib/social-platforms";

/**
 * Server Actions du News Engine (WP41).
 *
 * Règle de sécurité : l'IA ne publie jamais. Elle produit un Markdown, puis
 * l'action crée un Article en statut DRAFT et marque l'alerte comme traitée.
 * Seule une personne peut ensuite publier depuis le studio.
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

export type GenerateArticleResult = { articleId: string };

/** Crée l'article en brouillon, avec un slug unique. */
async function createDraftArticle(input: {
  title: string;
  excerpt: string;
  content: string;
  categoryId: string;
  authorId: string;
  alertId: string;
  themeId?: string;
}): Promise<GenerateArticleResult> {
  const base = slugify(input.title).slice(0, 90) || `article-${Date.now()}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const article = await prisma.$transaction(async (tx) => {
        const claimed = await tx.newsAlert.updateMany({ where: { id: input.alertId, status: "PENDING" }, data: { status: "DRAFT_GENERATED" } });
        if (claimed.count !== 1) throw new Error("Alerte déjà traitée.");
        const created = await tx.article.create({
          data: {
            title: input.title,
            slug,
            content: input.content,
            excerpt: input.excerpt,
            status: "DRAFT",
            format: "NEWS",
            isPremium: false,
            publishedAt: null,
            authorId: input.authorId,
            categoryId: input.categoryId,
            ...(input.themeId ? { themes: { connect: { id: input.themeId } } } : {}),
          },
          select: { id: true },
        });

        await tx.newsAlert.update({
          where: { id: input.alertId },
          data: { status: "DRAFT_GENERATED" },
        });

        return created;
      });

      return { articleId: article.id };
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < 4) continue;
      throw error;
    }
  }

  throw new Error("Impossible de générer un slug unique pour cet article.");
}

/**
 * Génère un brouillon à partir d'une alerte.
 *
 * L'alerte n'est marquée DRAFT_GENERATED qu'après la création réussie de
 * l'article : un échec de l'IA la laisse en PENDING pour une nouvelle tentative.
 */
export type AlertActionResult = { success: boolean; message: string; articleId?: string };

export async function generateArticle(alertId: string): Promise<AlertActionResult> {
  const user = await requireBackofficeUser();
  if (typeof alertId !== "string" || !alertId || alertId.length > 200) return { success: false, message: "Alerte introuvable." };
  if (!isAiConfigured()) return { success: false, message: "Clé IA absente." };
  try {
    const alert = await prisma.newsAlert.findUnique({ where: { id: alertId }, include: { source: { select: { name: true } } } });
    if (!alert || alert.status !== "PENDING") return { success: false, message: "Cette alerte a déjà été traitée ou supprimée." };
    const [categories, themes] = await Promise.all([
      prisma.category.findMany({ select: { id: true, slug: true, name: true } }),
      prisma.theme.findMany({ select: { id: true, slug: true, name: true } }),
    ]);
    if (!categories.length) return { success: false, message: "Créez une catégorie avant de générer un article." };
    const generated = await generateArticleFromAlert({ title: alert.titleFr ?? alert.title, content: alert.content, url: alert.url, sourceName: alert.source.name, publishedAt: alert.publishedAt, categories, themes });
    const categoryId = categories.find(category => category.slug === generated.categorySlug)?.id ?? await defaultCategoryId();
    if (!categoryId) return { success: false, message: "Aucune catégorie disponible." };
    const themeId = themes.find(theme => theme.slug === generated.themeSlug)?.id;
    const result = await createDraftArticle({ ...generated, categoryId, themeId, authorId: user.id, alertId });
    revalidatePath("/backoffice/veille");
    revalidatePath("/studio/articles");
    return { success: true, message: "Brouillon généré", articleId: result.articleId };
  } catch (error) {
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
] as const;

type SourceTypeValue = (typeof SOURCE_TYPES)[number];

function isSourceType(value: string): value is SourceTypeValue {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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

  if (name.length < 2) {
    failSource("Le nom de la source doit contenir au moins 2 caractères.");
  }
  if (!isSourceType(typeValue)) {
    failSource("Type de source invalide.");
  }

  const url = normalizeSourceUrl(rawUrl, typeValue).toString();

  try {
    await prisma.newsSource.create({
      data: { name, type: typeValue, url, active: true },
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

  revalidatePath("/backoffice/veille");
  revalidatePath("/backoffice/veille/sources");
  redirect(sourcesUrl({ info: `Source « ${name} » ajoutée et activée.` }));
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
