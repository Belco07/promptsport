import sharp from "sharp";

import { renderArticleOgImage } from "@/lib/article-og-image";

/**
 * Image Instagram d'un article.
 *
 * Meta n'accepte que le JPEG pour `image_url`. Cette route reprend l'image Open
 * Graph de l'article et la convertit à la volée, afin de ne dépendre ni du
 * format de la couverture téléversée ni du PNG produit par `ImageResponse`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const image = await renderArticleOgImage(slug);
  const png = Buffer.from(await image.arrayBuffer());
  const jpeg = await sharp(png)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();

  return new Response(jpeg, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpeg.byteLength),
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
