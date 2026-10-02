import { ImageResponse } from "next/og";

import { prisma } from "@/lib/prisma";
import { SITE_NAME } from "@/lib/seo";

/**
 * Image Open Graph dynamique d'un article (WP8a) : catégorie, titre et
 * signature du site. Servie sur /article/[slug]/opengraph-image.
 */

export const alt = "Aperçu de l'article";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Tronque un titre trop long pour tenir sur une ligne raisonnable. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const article = await prisma.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: { title: true, category: { select: { name: true } } },
  });

  const title = truncate(article?.title ?? "Article", 110);
  const category = article?.category?.name ?? "Sport";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #0b1b3a 0%, #1d4ed8 100%)",
          color: "white",
          fontFamily: "sans-serif",
          padding: 72,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "white",
              color: "#1d4ed8",
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 600 }}>{SITE_NAME}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              fontSize: 26,
              letterSpacing: 4,
              textTransform: "uppercase",
              background: "rgba(255,255,255,0.18)",
              padding: "10px 22px",
              borderRadius: 999,
            }}
          >
            {category}
          </div>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 700, marginTop: 28, lineHeight: 1.15 }}>
            {title}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 26, opacity: 0.85 }}>
          L&apos;actualité sportive en continu
        </div>
      </div>
    ),
    size,
  );
}
