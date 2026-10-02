import { prisma } from "@/lib/prisma";
import { SITE_NAME } from "@/lib/seo";
import { RSS_HEADERS, buildRssFeed, rssArticleSelect } from "@/lib/rss";

/**
 * Flux RSS par catégorie (WP8b) : les 50 derniers articles publiés d'une
 * catégorie. Accessible sur /rss/<slug> ; 404 si la catégorie n'existe pas.
 */

export const revalidate = 900;

const ITEMS_LIMIT = 50;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const category = await prisma.category.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });

  if (!category) {
    return new Response("Catégorie introuvable.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const articles = await prisma.article.findMany({
    where: { status: "PUBLISHED", categoryId: category.id },
    orderBy: { publishedAt: "desc" },
    take: ITEMS_LIMIT,
    select: rssArticleSelect,
  });

  const xml = buildRssFeed({
    title: `${SITE_NAME} — ${category.name}`,
    description: `Les derniers articles de la rubrique ${category.name}.`,
    path: `/rss/${category.slug}`,
    articles,
  });

  return new Response(xml, { headers: RSS_HEADERS });
}
