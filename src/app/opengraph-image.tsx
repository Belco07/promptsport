import { ImageResponse } from "next/og";

/**
 * Image Open Graph par défaut du site (WP8a), servie sur /opengraph-image.
 * Elle sert d'aperçu à toutes les pages qui n'ont pas d'image propre.
 */

export const alt = "Mon Site d'Actualités — l'actualité sportive en continu";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #0b1b3a 0%, #1d4ed8 100%)",
          color: "white",
          fontFamily: "sans-serif",
          padding: 80,
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 8, opacity: 0.85 }}>
          SPORT
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 84,
            fontWeight: 700,
            marginTop: 24,
            textAlign: "center",
          }}
        >
          Mon Site d&apos;Actualités
        </div>
        <div style={{ display: "flex", fontSize: 36, marginTop: 28, opacity: 0.9 }}>
          L&apos;actualité sportive en continu
        </div>
      </div>
    ),
    size,
  );
}
