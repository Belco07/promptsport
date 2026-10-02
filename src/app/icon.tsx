import { ImageResponse } from "next/og";

/**
 * Icône du site (WP8a), servie sur /icon : favicon moderne au format PNG.
 */

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 300,
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
