import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo";

/**
 * robots.txt (WP8b), servi sur /robots.txt.
 *
 * Les pages publiques sont indexables ; les espaces techniques (rédaction,
 * administration, espace abonné, API, connexion, retours de paiement) et les
 * images Open Graph générées sont bloqués. Le sitemap est déclaré ici.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/studio/",
          "/backoffice/",
          "/mon-compte/",
          "/api/",
          "/login",
          "/abonnement/success",
          "/abonnement/cancel",
          "/opengraph-image",
          "/*/opengraph-image",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
