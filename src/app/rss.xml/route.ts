import { prisma } from "@/lib/prisma";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import { RSS_HEADERS, buildRssFeed, rssArticleSelect, type RssArticle } from "@/lib/rss";

/**
 * Flux RSS principal (WP8b) : les 50 derniers articles publiés.
 * Accessible sur /rss.xml.
 */

export const dynamic = "force-dynamic";

const ITEMS_LIMIT = 50;

export async function GET() {
  let articles: RssArticle[] = [];
  let unavailable = false;
  try {
    articles = await prisma.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: ITEMS_LIMIT,
      select: rssArticleSelect,
    });
  } catch {
    unavailable = true;
    console.error("[rss] Données indisponibles. Flux vide retourné.");
  }

  const xml = buildRssFeed({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    path: "/rss.xml",
    articles,
  });

  return new Response(xml, { headers: unavailable ? { ...RSS_HEADERS, "Cache-Control": "no-store" } : RSS_HEADERS });
}
