import { prisma } from "@/lib/prisma";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import { RSS_HEADERS, buildRssFeed, rssArticleSelect } from "@/lib/rss";

/**
 * Flux RSS principal (WP8b) : les 50 derniers articles publiés.
 * Accessible sur /rss.xml.
 */

export const revalidate = 900;

const ITEMS_LIMIT = 50;

export async function GET() {
  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: ITEMS_LIMIT,
    select: rssArticleSelect,
  });

  const xml = buildRssFeed({
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    path: "/rss.xml",
    articles,
  });

  return new Response(xml, { headers: RSS_HEADERS });
}
