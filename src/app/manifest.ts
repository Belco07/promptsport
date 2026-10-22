import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { id: "/", name: "PromptSport", short_name: "PromptSport", description: "L’actualité sportive et les alertes Flash de PromptSport.", lang: "fr", start_url: "/", scope: "/", display: "standalone", background_color: "#111410", theme_color: "#111410", icons: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
