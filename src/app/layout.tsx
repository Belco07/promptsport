import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { Inter } from "next/font/google";

import { Analytics } from "@/components/Analytics";
import { LiveScoresBar, type ScoresStripMatch } from "@/components/LiveScoresBar";
import { PublicNav, type NavCompetition } from "@/components/PublicNav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_OG_IMAGE,
  HOME_TITLE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  TWITTER_CREATOR,
  absoluteUrl,
} from "@/lib/seo";
import "./globals.css";

/**
 * Police du design system (WP9).
 *
 * Inter est auto-hébergée par next/font : aucun appel à Google au chargement,
 * aucune requête tierce, et `display: "swap"` évite un texte invisible pendant
 * le téléchargement. La variable `--font-inter` est consommée par
 * tailwind.config.js (fontFamily.sans / fontFamily.display), ce qui permet de
 * changer de police sans toucher aux composants.
 *
 * Les graisses 700/800 servent aux titres : une seule famille suffit, ce qui
 * évite de télécharger une seconde police pour un gain visuel marginal.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

/**
 * Métadonnées globales (WP8a) : URL de base, gabarit de titre, Open Graph,
 * Twitter Card, icônes et robots. Les pages publiques surchargent ensuite
 * canonical / openGraph / twitter via `buildPageMetadata`.
 *
 * Aucune URL canonique n'est déclarée ici : elle serait héritée par toutes les
 * pages (y compris /login ou /studio) et pointerait à tort vers l'accueil.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: HOME_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)],
  },
  twitter: {
    card: "summary_large_image",
    creator: TWITTER_CREATOR,
    site: TWITTER_CREATOR,
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: [absoluteUrl(DEFAULT_OG_IMAGE)],
  },
  icons: {
    icon: [
      // Favicon historique (src/app/favicon.ico) et version PNG 512 générée.
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Compétitions du menu déroulant de la barre publique (WP9).
 *
 * La requête est mise en cache cinq minutes : le menu est identique sur toutes
 * les pages, il ne doit ni interroger la base à chaque affichage ni empêcher la
 * génération statique / ISR des pages publiques. En cas d'indisponibilité de la
 * base, la navigation se contente de ne rien proposer plutôt que de faire
 * échouer toutes les pages du site (y compris /studio et /backoffice).
 */
const getNavCompetitions = unstable_cache(
  async (): Promise<NavCompetition[]> => {
    try {
      return await prisma.competition.findMany({
        orderBy: { name: "asc" },
        take: 8,
        select: { slug: true, name: true },
      });
    } catch (error) {
      console.warn("[nav] compétitions indisponibles :", error);
      return [];
    }
  },
  ["nav-competitions"],
  { revalidate: 300 },
);

/**
 * Matchs du bandeau de scores, tout en haut des pages publiques.
 *
 * Trois ensembles, dans cet ordre : les matchs **en direct** (quel que soit leur
 * jour — une rencontre peut se terminer après minuit), puis les matchs du jour.
 * Si les deux sont vides — la synchronisation sportive peut dater de plusieurs
 * jours — on affiche les derniers résultats plutôt qu'un bandeau vide.
 *
 * Le cache est court (30 s) puisque le direct change vite, mais il reste un cache
 * de données (`unstable_cache`) : les pages publiques restent prérendues, aucune
 * ne devient dynamique. En cas d'indisponibilité de la base, le bandeau disparaît
 * au lieu de faire échouer les pages.
 */
const STRIP_SELECT = {
  id: true,
  status: true,
  homeScore: true,
  awayScore: true,
  scheduledAt: true,
  competition: { select: { name: true, slug: true } },
  homeTeam: { select: { name: true, shortName: true } },
  awayTeam: { select: { name: true, shortName: true } },
} as const;

const getScoresStripMatches = unstable_cache(
  async (): Promise<ScoresStripMatch[]> => {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setDate(endOfDay.getDate() + 1);

      const [live, today] = await Promise.all([
        prisma.match.findMany({
          where: { status: "LIVE" },
          orderBy: { scheduledAt: "asc" },
          take: 8,
          select: STRIP_SELECT,
        }),
        prisma.match.findMany({
          where: { scheduledAt: { gte: startOfDay, lt: endOfDay } },
          orderBy: { scheduledAt: "asc" },
          take: 12,
          select: STRIP_SELECT,
        }),
      ]);

      const seen = new Set<string>();
      const collected = [...live, ...today].filter((match) => {
        if (seen.has(match.id)) return false;
        seen.add(match.id);
        return true;
      });

      if (collected.length > 0) {
        return collected;
      }

      return await prisma.match.findMany({
        where: { status: "FINISHED", homeScore: { not: null } },
        orderBy: { scheduledAt: "desc" },
        take: 8,
        select: STRIP_SELECT,
      });
    } catch (error) {
      console.warn("[bandeau scores] matchs indisponibles :", error);
      return [];
    }
  },
  ["scores-strip"],
  { revalidate: 30 },
);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const competitions = await getNavCompetitions();
  const stripMatches = await getScoresStripMatches();

  return (
    <html lang="fr" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Découverte automatique du flux RSS (WP8b). Déclarée ici plutôt que
            dans `metadata.alternates` : chaque page publique remplace
            `alternates` par son URL canonique, ce qui effacerait la balise. */}
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Flux RSS"
          href="/rss.xml"
        />
      </head>
      {/* `suppressHydrationWarning` sur <html> : next-themes pose la classe du
          thème avant l'hydratation (script injecté), React constate donc un
          attribut différent de son rendu serveur. L'avertissement est attendu et
          sans conséquence — la classe est appliquée dès le premier paint, ce qui
          évite le flash de thème clair. */}
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {/* Lien d'évitement : première cible du clavier (WCAG 2.4.1). */}
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Aller au contenu principal
        </a>
        <ThemeProvider>
          <PublicNav
            competitions={competitions}
            scoresBar={<LiveScoresBar matches={stripMatches} />}
          />
          {children}
          {/* Collecte analytics first-party (WP8d) : un beacon après `load`. */}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
