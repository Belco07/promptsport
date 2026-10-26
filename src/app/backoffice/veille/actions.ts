"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { isAiConfigured, translateTitlesToFrench } from "@/lib/ai";
import { auth } from "@/lib/auth";
import { withDatabaseRetry } from "@/lib/database-retry";
import { generateNewsArticle } from "@/lib/news-generation";
import { AUTO_PUBLISH_RELIABILITY } from "@/lib/news-automation";
import { prisma } from "@/lib/prisma";
import { canAccessBackoffice } from "@/lib/roles";
import {
  facebookPageFromUrl,
  instagramUsernameFromUrl,
  xHandleFromUrl,
} from "@/lib/social-platforms";

/**
 * Server Actions du News Engine (WP41, WP47, WP49).
 *
 * L'IA produit un article à partir de n'importe quelle alerte de veille, dans la
 * limite du quota quotidien. L'article reste en DRAFT, sauf pour une alerte 5 🔥
 * dont la source est explicitement autorisée à publier automatiquement, atteint
 * le seuil de fiabilité de 95/100 et dispose d'un visuel. Toute autre
 * publication reste une décision humaine.
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export type AlertActionResult = {
  success: boolean;
  message: string;
  articleId?: string;
  published?: boolean;
  /** Publication automatique bloquée faute de visuel exploitable. */
  photoBlocked?: boolean;
  /** Format retenu par l'IA (FLASH, NEWS ou ANALYSIS). */
  format?: "FLASH" | "NEWS" | "ANALYSIS";
};

/**
 * Génère un article à partir de n'importe quelle alerte en attente.
 *
 * WP49 : la génération manuelle n'est plus réservée aux 5 🔥. La publication
 * automatique reste conditionnée par la source (autoPublish + fiabilité 95) et
 * par la disponibilité d'un visuel.
 */
export async function generateArticle(alertId: string): Promise<AlertActionResult> {
  const user = await requireBackofficeUser();
  if (typeof alertId !== "string" || !alertId || alertId.length > 200) {
    return { success: false, message: "Alerte introuvable." };
  }
  if (!isAiConfigured()) return { success: false, message: "Clé IA absente." };

  const result = await generateNewsArticle({ alertId, authorId: user.id });

  if (result.success) {
    revalidatePath("/backoffice/veille");
    revalidatePath("/studio/articles");
    if (result.published) {
      revalidatePath("/");
      revalidatePath("/sitemap.xml");
      revalidatePath("/rss.xml");
    }
  }

  return result;
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
        ? " Photo non licenciée : un visuel édité (titre + logo) sera utilisé, sinon l'article restera en brouillon."
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
        ? `Publication automatique activée pour « ${source.name} » (fiabilité ${reliability}/100, visuel source repris tel quel).`
        : `Publication automatique activée pour « ${source.name} » (fiabilité ${reliability}/100, visuel édité avec le titre et le logo).`
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

  // WP49 : pipeline automatique des alertes 5 🔥 après la collecte. Un échec de
  // génération ne doit pas masquer le résultat de la récupération.
  let autoNote = "";
  try {
    const { autoGenerateViralAlerts } = await import("@/lib/news-generation");
    const auto = await autoGenerateViralAlerts({ limit: 5 });
    if (auto.generated > 0) {
      autoNote = ` ${auto.generated} article(s) 5 🔥 généré(s)` +
        (auto.published > 0 ? `, dont ${auto.published} publié(s) automatiquement.` : ", en brouillon.");
      revalidatePath("/studio/articles");
    }
    if (auto.failed > 0) {
      autoNote += ` ${auto.failed} génération(s) 5 🔥 en échec.`;
    }
  } catch (error) {
    console.error(
      "[veille] pipeline 5 🔥 interrompu :",
      error instanceof Error ? error.message : error,
    );
  }

  const message = result.sourcesProcessed === 0
    ? "Aucune source active à récupérer."
    : result.alertsCreated + (result.alertsCreated === 1 ? " nouvelle alerte importée." : " nouvelles alertes importées.")
      + (result.sourcesFailed ? " " + result.sourcesFailed + " source(s) indisponible(s)." : "")
      + autoNote;
  redirect(veilUrl({ info: message, refreshed: true }));
}
