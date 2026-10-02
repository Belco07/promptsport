import { ImageResponse } from "next/og";

/**
 * Icône Apple Touch (WP8a), servie sur /apple-icon : reprise du favicon en
 * 180x180 pour les écrans d'accueil iOS.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #1d4ed8 0%, #0b1b3a 100%)",
          color: "white",
          fontSize: 110,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        M
      </div>
    ),
    size,
  );
}
