import { prisma } from "@/lib/prisma";

/**
 * Règles d'automatisation de la veille (WP47, WP49).
 *
 * Le News Engine reçoit plusieurs centaines d'alertes par jour. Toute alerte
 * peut être générée manuellement ; le pipeline automatique ne traite que les
 * alertes jugées virales (score 5/5), dans la limite du quota quotidien.
 * L'article n'est publié automatiquement que pour une source explicitement
 * autorisée et dont la fiabilité atteint le seuil de 95/100, et si un visuel
 * (d'origine licencié ou édité) a pu être produit.
 */

export const DEFAULT_MAX_DAILY_AI_DRAFTS = 15;
export const AI_QUOTA_MESSAGE = "Quota IA atteint pour aujourd'hui";
export const AUTO_PUBLISH_RELIABILITY = 95;
export const EDITORIAL_TIME_ZONE = "Africa/Lagos";

/** Nombre maximal de générations IA autorisées sur la journée. */
export function maxDailyAiDrafts(): number {
  const raw = process.env.MAX_DAILY_AI_DRAFTS?.trim();
  if (!raw) return DEFAULT_MAX_DAILY_AI_DRAFTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_MAX_DAILY_AI_DRAFTS;
}

/**
 * Début de la journée éditoriale, calée sur Africa/Lagos comme le reste du
 * backoffice. Le fuseau n'applique pas d'heure d'été : minuit local correspond
 * à 23:00 UTC la veille.
 */
export function startOfEditorialDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: EDITORIAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day) - 60 * 60 * 1000);
}

type ArticleCounter = {
  article: {
    count(args: {
      where: {
        newsSourceId: { not: null };
        createdAt: { gte: Date };
      };
    }): Promise<number>;
  };
};

/**
 * Compte les articles issus de la veille créés aujourd'hui.
 *
 * `newsSourceId` est renseigné uniquement par la génération depuis une alerte :
 * les articles saisis dans le studio ne consomment donc pas le quota IA.
 */
export async function countAiDraftsToday(
  now: Date = new Date(),
  client: ArticleCounter = prisma,
): Promise<number> {
  return client.article.count({
    where: {
      newsSourceId: { not: null },
      createdAt: { gte: startOfEditorialDay(now) },
    },
  });
}

export type AiDraftQuota = {
  limit: number;
  used: number;
  remaining: number;
};

/** Quota restant pour la journée éditoriale en cours. */
export async function getAiDraftQuota(
  now: Date = new Date(),
  client: ArticleCounter = prisma,
): Promise<AiDraftQuota> {
  const limit = maxDailyAiDrafts();
  const used = await countAiDraftsToday(now, client);
  return { limit, used, remaining: Math.max(0, limit - used) };
}

/** Une source est-elle autorisée à publier automatiquement ? */
export function sourceCanAutoPublish(source: {
  autoPublish: boolean;
  reliability: number;
}): boolean {
  return source.autoPublish && source.reliability >= AUTO_PUBLISH_RELIABILITY;
}

/**
 * Une source autorise-t-elle la reprise de ses photos ?
 *
 * Par défaut, une source reste en `REFERENCE_ONLY` : son image peut illustrer
 * la veille interne, mais elle n'est jamais republiée telle quelle. Depuis WP49,
 * elle peut servir de base à un visuel édité (titre, logo, dégradé) pour les
 * articles de veille. Seul un visuel `LICENSED` est repris sans habillage.
 */
export function sourceAllowsImageUse(source: {
  imagePolicy: "REFERENCE_ONLY" | "LICENSED";
}): boolean {
  return source.imagePolicy === "LICENSED";
}

/**
 * Le calcul de viralité vit dans `news-virality.ts` (WP50), partagé avec la
 * collecte et la timeline éditoriale. Ce module ne garde que les règles de
 * quota et de publication automatique du WP47.
 */
