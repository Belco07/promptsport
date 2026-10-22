import { ARTICLE_OG_SIZE, renderArticleOgImage } from "@/lib/article-og-image";

/**
 * Image Open Graph dynamique d'un article (WP8a) : catégorie, titre et
 * signature du site. Servie sur /article/[slug]/opengraph-image.
 *
 * Le rendu est partagé avec la route Instagram, qui le convertit en JPEG.
 */

export const alt = "Aperçu de l'article";
export const size = ARTICLE_OG_SIZE;
export const contentType = "image/png";

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return renderArticleOgImage(slug);
}
