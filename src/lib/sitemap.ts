import { plainText, type FeedItem } from "@/lib/rss";
import {
  NEWS_BROWSER_USER_AGENT,
  cleanXmlValue,
  extractPageMetadata,
  fetchNewsPage,
} from "@/lib/news-page";
import { titleFromArticleUrl } from "@/lib/official-sites";

/**
 * Connecteur de sitemap d'actualités.
 *
 * Deux formats sont pris en charge :
 *  - les sitemaps « Google News » (`<news:news>`) qui contiennent déjà le
 *    titre et la date de publication ;
 *  - les sitemaps classiques (`<loc>` + `<lastmod>`) dont le titre est lu sur
 *    la page de l'article, ou déduit du slug pour les sites officiels.
 *
 * Les sitemaps d'index sont suivis sur un niveau, avec un nombre d'enfants
 * borné pour éviter d'aspirer un site entier.
 */

const MAX_SITEMAP_BYTES = 6_000_000;
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CHILD_SITEMAPS = 10;
const MAX_ARTICLE_FETCHES = 10;
const DEFAULT_TIMEOUT_MS = 45_000;
const FUTURE_TOLERANCE_MS = 6 * 60 * 60 * 1000;

type SitemapRule = {
  /** Ne garder que les URL dont le chemin correspond. */
  articlePattern?: RegExp;
  /** Déduire le titre du slug quand le sitemap n'en fournit pas. */
  titleFromUrl?: boolean;
  /** Casse de titre pour les slugs anglophones. */
  titleCaseFromUrl?: boolean;
  /** Lire la page d'article même si le sitemap fournit déjà titre et date. */
  enrichFromArticle?: boolean;
  /** Retire le nom du site ajouté au titre par la page d'article. */
  stripTitleSuffix?: RegExp;
  timeoutMs?: number;
};

const SITEMAP_RULES: Record<string, SitemapRule> = {
  "om.fr": {
    articlePattern: /^\/fr\/actualites\//,
    timeoutMs: 30_000,
  },
  "inside.fifa.com": {
    articlePattern: /^\/news\//,
    titleFromUrl: true,
    titleCaseFromUrl: true,
    enrichFromArticle: true,
    timeoutMs: 45_000,
  },
  "staderennais.com": {
    articlePattern: /^\/actualites\//,
    titleFromUrl: true,
    enrichFromArticle: true,
    stripTitleSuffix: /\s*\|\s*Stade Rennais.*$/i,
    timeoutMs: 30_000,
  },
  "ligue1.com": {
    articlePattern: /^\/fr\/articles\//,
  },
  "premierleague.com": {
    articlePattern: /^\/en\/news\//,
  },
};

export type SitemapEntry = {
  url: string;
  title: string | null;
  newsPublishedAt: Date | null;
  lastmod: Date | null;
};

export type ParsedSitemap = {
  entries: SitemapEntry[];
  sitemaps: string[];
};

function sitemapRuleFor(url: string): SitemapRule {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SITEMAP_RULES[host] ?? {};
  } catch {
    return {};
  }
}

function readDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(cleanXmlValue(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function readLoc(block: string): string | null {
  const value = block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)?.[1];
  return value ? cleanXmlValue(value) || null : null;
}

function resolveUrl(value: string, baseUrl: string): string | null {
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Analyse un sitemap XML sans dépendance externe. */
export function parseSitemap(xml: string, baseUrl: string): ParsedSitemap {
  const entries: SitemapEntry[] = [];
  for (const match of xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const block = match[1];
    const loc = readLoc(block);
    const url = loc ? resolveUrl(loc, baseUrl) : null;
    if (!url) continue;

    const titleValue = block.match(/<news:title\b[^>]*>([\s\S]*?)<\/news:title>/i)?.[1];
    const publishedValue =
      block.match(/<news:publication_date\b[^>]*>([\s\S]*?)<\/news:publication_date>/i)?.[1] ??
      block.match(/<news:publicationDate\b[^>]*>([\s\S]*?)<\/news:publicationDate>/i)?.[1] ??
      block.match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1];
    const lastmodValue = block.match(/<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i)?.[1];

    entries.push({
      url,
      title: titleValue ? plainText(titleValue).slice(0, 300) || null : null,
      newsPublishedAt: readDate(publishedValue),
      lastmod: readDate(lastmodValue),
    });
  }

  const sitemaps: string[] = [];
  for (const match of xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)) {
    const loc = readLoc(match[1]);
    const url = loc ? resolveUrl(loc, baseUrl) : null;
    if (url && !sitemaps.includes(url)) sitemaps.push(url);
  }

  return { entries, sitemaps };
}

async function fetchSitemapXml(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ xml: string; finalUrl: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL de sitemap invalide.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Seules les URL HTTP(S) sont acceptées.");
  }

  const response = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": NEWS_BROWSER_USER_AGENT,
      Accept: "application/xml,text/xml,application/rss+xml,application/atom+xml;q=0.9,*/*;q=0.7",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} pour le sitemap ${parsed.toString()}.`);

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SITEMAP_BYTES) {
    throw new Error(`Sitemap trop volumineux (${declaredLength} octets).`);
  }

  const xml = await response.text();
  if (xml.length > MAX_SITEMAP_BYTES) {
    throw new Error(`Sitemap trop volumineux (${xml.length} caractères).`);
  }
  if (/^\s*<!doctype\s+html|^\s*<html\b/i.test(xml)) {
    throw new Error("Le sitemap renvoie une page HTML (protection anti-bot ou URL invalide).");
  }
  return { xml, finalUrl: response.url || parsed.toString() };
}

async function loadSitemap(url: string, depth = 0): Promise<SitemapEntry[]> {
  const rule = sitemapRuleFor(url);
  const { xml, finalUrl } = await fetchSitemapXml(url, rule.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const parsed = parseSitemap(xml, finalUrl);
  if (parsed.sitemaps.length === 0 || depth >= 1) return parsed.entries;

  const children = parsed.sitemaps.slice(0, MAX_CHILD_SITEMAPS);
  const collected = [...parsed.entries];
  for (const child of children) {
    try {
      collected.push(...(await loadSitemap(child, depth + 1)));
    } catch {
      // Un enfant indisponible ne doit pas annuler les autres.
    }
  }
  return collected;
}

function entryDate(entry: SitemapEntry): Date | null {
  return entry.newsPublishedAt ?? entry.lastmod;
}

function matchesRule(entry: SitemapEntry, rule: SitemapRule): boolean {
  if (!rule.articlePattern) return true;
  try {
    return rule.articlePattern.test(new URL(entry.url).pathname);
  } catch {
    return false;
  }
}

/**
 * Récupère les articles récents d'un sitemap. Les entrées sans titre sont
 * complétées en lisant la page de l'article, ou en déduisant le titre du slug
 * pour les sites officiels configurés.
 */
export async function fetchSitemapItems(
  sitemapUrl: string,
  limit = 10,
): Promise<FeedItem[]> {
  const maxItems = Math.max(1, limit);
  const entries = await loadSitemap(sitemapUrl);
  const seen = new Set<string>();
  const now = Date.now();
  const windowStart = now - LOOKBACK_MS;

  const candidates = entries
    .filter((entry) => !seen.has(entry.url) && seen.add(entry.url))
    .filter((entry) => matchesRule(entry, sitemapRuleFor(entry.url)))
    .filter((entry) => {
      const date = entryDate(entry);
      if (!date) return true;
      return (
        date.getTime() >= windowStart &&
        date.getTime() <= now + FUTURE_TOLERANCE_MS
      );
    })
    .map((entry, index) => ({ entry, index, date: entryDate(entry) }))
    .sort((a, b) => {
      if (a.date && b.date) return b.date.getTime() - a.date.getTime();
      if (a.date) return -1;
      if (b.date) return 1;
      return a.index - b.index;
    })
    .slice(0, Math.max(maxItems * 4, 12));

  const items: FeedItem[] = [];
  let articleFetches = 0;

  for (const candidate of candidates) {
    if (items.length >= maxItems) break;
    const { entry } = candidate;
    const rule = sitemapRuleFor(entry.url);
    let title = entry.title;
    if (!title && rule.titleFromUrl) {
      title = titleFromArticleUrl(entry.url, {
        titleCase: rule.titleCaseFromUrl,
      });
    }
    let publishedAt = candidate.date;
    let content: string | null = null;

    if (!title || !publishedAt || rule.enrichFromArticle) {
      if (articleFetches >= MAX_ARTICLE_FETCHES) break;
      articleFetches += 1;
      try {
        const page = await fetchNewsPage(entry.url, 12_000);
        const metadata = extractPageMetadata(page.html);
        const pageTitle = rule.stripTitleSuffix
          ? metadata.title?.replace(rule.stripTitleSuffix, "").trim()
          : metadata.title;
        title = pageTitle || title;
        publishedAt ??= metadata.publishedAt;
        content = metadata.description;
      } catch {
        // On garde l'entrée si le sitemap fournit déjà titre et date.
      }
    }

    if (!title || !publishedAt) continue;
    items.push({
      title: title.slice(0, 300),
      url: entry.url,
      content,
      publishedAt,
    });
  }

  return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
