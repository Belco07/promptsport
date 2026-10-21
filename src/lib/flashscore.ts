import { plainText, type FeedItem } from "@/lib/rss";
import { fetchNewsPage } from "@/lib/news-page";

/**
 * Connecteur Flashscore « Actualités ».
 *
 * Flashscore n'expose ni RSS ni Atom sur cette page. Le site embarque en
 * revanche `window.fsNewsData`, un JSON qui contient les sections et leurs
 * articles (titre, URL, date de publication en secondes). On lit uniquement ce
 * payload public, sans navigateur headless ni scraping du DOM.
 */

export const FLASHSCORE_NEWS_URL = "https://www.flashscore.fr/actualites/";

type FlashscoreArticle = {
  title?: unknown;
  url?: unknown;
  published?: unknown;
  description?: unknown;
  perex?: unknown;
};

type FlashscoreSection = {
  articles?: unknown;
};

type FlashscorePayload = {
  data?: {
    sections?: unknown;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Extrait l'objet JSON affecté à `window.fsNewsData` en équilibrant les
 * accolades. Une simple regex s'arrêterait au premier `}` d'un objet imbriqué.
 */
export function extractFlashscorePayload(html: string): FlashscorePayload {
  const marker = html.indexOf("window.fsNewsData");
  if (marker < 0) {
    throw new Error("Payload Flashscore introuvable (window.fsNewsData absent).");
  }
  const start = html.indexOf("{", marker);
  if (start < 0) throw new Error("Payload Flashscore illisible.");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const raw = html.slice(start, index + 1);
        try {
          return JSON.parse(raw) as FlashscorePayload;
        } catch {
          throw new Error("Payload Flashscore invalide (JSON non analysable).");
        }
      }
    }
  }

  throw new Error("Payload Flashscore incomplet.");
}

function articleDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return articleDate(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function articleUrl(value: unknown, baseUrl: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Analyse le HTML Flashscore et retourne les articles les plus récents. */
export function parseFlashscoreItems(
  html: string,
  limit = 10,
  baseUrl = FLASHSCORE_NEWS_URL,
): FeedItem[] {
  const payload = extractFlashscorePayload(html);
  const sections = payload.data?.sections;
  if (!Array.isArray(sections)) {
    throw new Error("Structure Flashscore inattendue : sections absentes.");
  }

  const seen = new Set<string>();
  const items: FeedItem[] = [];

  const visitSection = (section: unknown): void => {
    if (!isRecord(section)) return;
    const typedSection = section as FlashscoreSection;
    if (!Array.isArray(typedSection.articles)) return;

    for (const rawArticle of typedSection.articles) {
      if (!isRecord(rawArticle)) continue;
      const article = rawArticle as FlashscoreArticle;
      const title = plainText(typeof article.title === "string" ? article.title : "").slice(0, 300);
      const url = articleUrl(article.url, baseUrl);
      const publishedAt = articleDate(article.published);
      if (!title || !url || !publishedAt || seen.has(url)) continue;

      seen.add(url);
      const contentSource =
        typeof article.description === "string"
          ? article.description
          : typeof article.perex === "string"
            ? article.perex
            : "";
      items.push({
        title,
        url,
        content: plainText(contentSource).slice(0, 4000) || null,
        publishedAt,
      });
    }
  };

  for (const section of sections) visitSection(section);

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, Math.max(1, limit));
}

/** Récupère la page Flashscore puis extrait les articles. */
export async function fetchFlashscoreItems(
  pageUrl: string,
  limit = 10,
): Promise<FeedItem[]> {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new Error("URL Flashscore invalide.");
  }
  if (!/(^|\.)flashscore\.(fr|com)$/i.test(parsed.hostname)) {
    throw new Error("URL Flashscore invalide : utilisez un domaine flashscore.fr ou flashscore.com.");
  }

  const page = await fetchNewsPage(parsed.toString());
  return parseFlashscoreItems(page.html, limit, page.finalUrl);
}
