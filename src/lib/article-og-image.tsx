import { ImageResponse } from "next/og";

import { prisma } from "@/lib/prisma";
import { SITE_NAME } from "@/lib/seo";

/**
 * Rendu partagé de l'image Open Graph d'un article.
 *
 * La route de métadonnées la sert en PNG pour les réseaux sociaux classiques ;
 * la route Instagram la convertit en JPEG, seul format accepté par l'API de
 * publication Meta.
 */

export const ARTICLE_OG_SIZE = { width: 1200, height: 630 };

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export async function renderArticleOgImage(slug: string): Promise<ImageResponse> {
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
    ARTICLE_OG_SIZE,
  );
}
