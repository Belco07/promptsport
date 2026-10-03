import { SITE_DESCRIPTION, SITE_NAME, absoluteUrl } from "@/lib/seo";

/**
 * Génération des flux RSS 2.0 (WP8b).
 *
 * Aucune bibliothèque externe : le XML est construit à la main, avec échappement
 * systématique des valeurs (titres, extraits) pour rester valide.
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
