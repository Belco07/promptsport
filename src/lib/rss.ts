import Parser from "rss-parser";

import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/seo";

/**
 * Génération des flux RSS 2.0 (WP8b).
 *
 * Aucune bibliothèque externe : le XML est construit à la main, avec échappement
 * systématique des valeurs (titres, extraits) pour rester valide.
 *
 * WP41 : ce module porte aussi la lecture des flux **externes** du News Engine
 * (`fetchRssItems`), d'où l'import de `rss-parser`.
 */

export type RssArticle = {
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  publishedAt: Date | null;
  updatedAt: Date;
  category: { name: string } | null;
};

/** Longueur maximale d'une description d'item. */
const DESCRIPTION_MAX = 300;

/** Échappe les caractères réservés du XML. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Date au format RFC 822 exigé par RSS 2.0 (« Tue, 10 Jun 2003 04:00:00 GMT »). */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

/** Description d'un article : extrait, sinon début du contenu, sur une seule ligne. */
export function articleDescription(article: RssArticle): string {
  const base = article.excerpt?.trim() || article.content;
  const compact = base.replace(/\s+/g, " ").trim();
  return compact.length > DESCRIPTION_MAX ? `${compact.slice(0, DESCRIPTION_MAX - 1)}…` : compact;
}

export type BuildFeedInput = {
  /** Titre du canal (« PromptSport » ou « … — Football »). */
  title: string;
  description: string;
  /** Chemin du flux, utilisé pour l'auto-référence atom:link. */
  path: string;
  articles: RssArticle[];
};

/** Construit un document RSS 2.0 complet. */
export function buildRssFeed({ title, description, path, articles }: BuildFeedInput): string {
  const selfUrl = absoluteUrl(path);
  const channelLink = absoluteUrl("/");
  const lastBuildDate = rfc822(
    articles[0]?.publishedAt ?? articles[0]?.updatedAt ?? new Date(),
  );

  const items = articles
    .map((article) => {
      const link = absoluteUrl(`/article/${article.slug}`);
      const lines = [
        "    <item>",
        `      <title>${escapeXml(article.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <description>${escapeXml(articleDescription(article))}</description>`,
        `      <pubDate>${rfc822(article.publishedAt ?? article.updatedAt)}</pubDate>`,
      ];
      if (article.category) {
        lines.push(`      <category>${escapeXml(article.category.name)}</category>`);
      }
      lines.push("    </item>");
      return lines.join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(channelLink)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    "    <language>fr-FR</language>",
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    `    <generator>${escapeXml(SITE_NAME)}</generator>`,
    ...(items ? [items] : []),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/** Sélection Prisma des champs nécessaires à un item RSS. */
export const rssArticleSelect = {
  title: true,
  slug: true,
  excerpt: true,
  content: true,
  publishedAt: true,
  updatedAt: true,
  category: { select: { name: true } },
} as const;

/** En-têtes de réponse d'un flux RSS. */
export const RSS_HEADERS = {
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=900, s-maxage=900",
} as const;

export { SITE_DESCRIPTION, SITE_NAME };

/* -------------------------------------------------------------------------- */
/* News Engine (WP41) — lecture des flux externes                             */
/* -------------------------------------------------------------------------- */

export type FeedItem = {
  title: string;
  url: string;
  content: string | null;
  publishedAt: Date;
  /** Photo trouvée dans le flux (enclosure, media:content, HTML…). */
  imageUrl?: string | null;
  /** Crédit photo fourni par la source, s'il existe. */
  imageCredit?: string | null;
};

/** Longueur maximale de l'extrait conservé en base et envoyé à l'IA. */
const MAX_CONTENT_LENGTH = 4000;

let feedParser: Parser | null = null;

function getFeedParser(): Parser {
  feedParser ??= new Parser({
    timeout: 20_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PromptSport News Engine/1.0; +https://promptsport.fr)",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
  });
  return feedParser;
}

/** Décode les entités numériques et les principales entités nommées. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#(x?)([0-9a-f]+);/gi, (match, hex: string, code: string) => {
      const point = Number.parseInt(code, hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, "'")
    .replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&hellip;/gi, "…")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–");
}

/** Retire les balises HTML et normalise les espaces d'un extrait de flux. */
export function plainText(value: string | undefined): string {
  if (!value) return "";
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!\[CDATA\[|\]\]>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT_LENGTH);
}

/** Date valide ou `null` : certaines sources publient des dates illisibles. */
function readDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Seules les URL HTTP(S) sont acceptées ; les liens relatifs sont résolus. */
function readUrl(value: string | undefined, base?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

/**
 * Extrait la première photo d'un élément de flux.
 *
 * Les médias envoient l'image de plusieurs façons selon leur CMS :
 * `enclosure`, `media:content`, `media:thumbnail`, `itunes:image` ou une
 * balise `<img>` dans le contenu HTML. On privilégie les métadonnées explicites
 * avant de retomber sur le contenu.
 */
function rssItemImage(
  item: Record<string, unknown>,
  articleUrl: string,
): string | null {
  const enclosure = asObject(item.enclosure);
  if (enclosure) {
    const type = firstString(enclosure.type)?.toLowerCase() ?? "";
    const url = firstString(enclosure.url);
    if (
      url &&
      (type.startsWith("image/") ||
        (!type && /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url)))
    ) {
      const resolved = readUrl(url, articleUrl);
      if (resolved) return resolved;
    }
  }

  for (const node of [
    ...asArray(item["media:content"]),
    ...asArray(item["media:thumbnail"]),
  ]) {
    const record = asObject(node);
    if (!record) continue;
    const attributes = asObject(record.$) ?? record;
    const type = (
      firstString(attributes.type) ?? firstString(attributes.medium) ?? ""
    ).toLowerCase();
    if (type && type !== "image" && !type.startsWith("image/")) continue;
    const resolved = readUrl(
      firstString(attributes.url, attributes.href),
      articleUrl,
    );
    if (resolved) return resolved;
  }

  const itunesImage = asObject(item["itunes:image"]);
  if (itunesImage) {
    const attributes = asObject(itunesImage.$) ?? itunesImage;
    const resolved = readUrl(
      firstString(attributes.href, attributes.url),
      articleUrl,
    );
    if (resolved) return resolved;
  }

  for (const html of [item["content:encoded"], item.content, item.summary]) {
    if (typeof html !== "string") continue;
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const candidate =
        tag.match(/\bdata-src\s*=\s*["']([^"']+)["']/i)?.[1] ??
        tag.match(/\bdata-original\s*=\s*["']([^"']+)["']/i)?.[1] ??
        tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
      const resolved = readUrl(
        candidate ? decodeEntities(candidate) : undefined,
        articleUrl,
      );
      if (resolved) return resolved;
    }
  }

  return null;
}

/** Crédit photo déclaré par le flux, sans le préfixe « Photo : ». */
function rssItemCredit(item: Record<string, unknown>): string | null {
  const candidates = [
    item["media:credit"],
    item["media:copyright"],
    item.copyright,
  ];
  for (const candidate of candidates) {
    let text: string | undefined;
    if (typeof candidate === "string") text = candidate;
    else {
      const record = asObject(candidate);
      text = firstString(record?._, record?.name, record?.url);
    }
    const credit = plainText(text).slice(0, 120);
    if (credit) return credit;
  }
  return null;
}

/**
 * Récupère les derniers éléments d'un flux RSS/Atom externe.
 *
 * @param feedUrl URL du flux, telle qu'enregistrée dans `NewsSource`.
 * @param limit   Nombre maximal d'éléments retournés (les plus récents).
 */
export async function fetchRssItems(feedUrl: string, limit = 10): Promise<FeedItem[]> {
  const url = readUrl(feedUrl);
  if (!url) throw new Error("URL de flux RSS invalide.");

  const feed = await getFeedParser().parseURL(url);
  const items: FeedItem[] = [];

  for (const item of feed.items ?? []) {
    const title = plainText(item.title).slice(0, 300);
    const link = readUrl(item.link ?? item.guid, url);
    if (!title || !link) continue;

    const rawItem = item as unknown as Record<string, unknown>;
    items.push({
      title,
      url: link,
      content: plainText(item.contentSnippet ?? item.content ?? item.summary) || null,
      publishedAt: readDate(item.isoDate ?? item.pubDate) ?? new Date(),
      imageUrl: rssItemImage(rawItem, link),
      imageCredit: rssItemCredit(rawItem),
    });
  }

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, Math.max(1, limit));
}
