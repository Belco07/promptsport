import type { MetadataRoute } from "next";

import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/seo";

/**
 * Sitemap XML (WP8b), servi sur /sitemap.xml.
 *
 * Contenu : pages fixes publiques, articles publiés, compétitions, et matchs
 * dans une fenêtre de 30 jours passés / 30 jours à venir. Les pages techniques
 * (studio, backoffice, espace abonné, connexion, retours de paiement) et les
 * articles non publiés sont exclus par construction.
 *
 * Évolutivité : la limite Google est de 50 000 URLs par fichier. On plafonne
 * donc le résultat ; au-delà, la suite consiste à passer à un sitemap index via
 * `generateSitemaps()` de Next.js (sous-sitemaps articles / matchs /
 * compétitions), sans changer les requêtes ci-dessous.
 */

/** Limite officielle d'un fichier sitemap. */
const MAX_URLS = 50000;

/** Fenêtre de publication des matchs, en jours. */
const MATCH_WINDOW_DAYS = 30;

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - MATCH_WINDOW_DAYS * 864e5);
  const windowEnd = new Date(now.getTime() + MATCH_WINDOW_DAYS * 864e5);

  const [articles, competitions, matches] = await Promise.all([
    prisma.article.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      select: { slug: true, publishedAt: true, updatedAt: true },
    }),
    prisma.competition.findMany({
      orderBy: { name: "asc" },
      select: { slug: true, updatedAt: true },
    }),
    prisma.match.findMany({
      where: { scheduledAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { scheduledAt: "desc" },
      select: { id: true, status: true, scheduledAt: true, updatedAt: true },
    }),
  ]);

  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: articles[0]?.publishedAt ?? now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/scores`,
      lastModified: matches[0]?.updatedAt ?? now,
      changeFrequency: "hourly",
      priority: 0.7,
    },
    // /abonnement est volontairement ABSENT : la page est en `noindex`
    // (WP8a), et déclarer une URL noindex dans un sitemap fait remonter un
    // avertissement « Exclue par la balise noindex » dans Search Console.
  ];

  for (const article of articles) {
    entries.push({
      url: `${SITE_URL}/article/${article.slug}`,
      lastModified: article.updatedAt,
      changeFrequency: "daily",
      priority: 0.8,
    });
  }

  for (const competition of competitions) {
    entries.push({
      url: `${SITE_URL}/competition/${competition.slug}`,
      lastModified: competition.updatedAt,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  for (const match of matches) {
    entries.push({
      url: `${SITE_URL}/match/${match.id}`,
      lastModified: match.updatedAt,
      changeFrequency: match.status === "LIVE" ? "hourly" : "daily",
      priority: 0.6,
    });
  }

  return entries.slice(0, MAX_URLS);
}
