import type { Metadata, Viewport } from "next";
import { unstable_cache } from "next/cache";
import localFont from "next/font/local";
import { Sora } from "next/font/google";

import { Analytics } from "@/components/Analytics";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { PublicNav, type NavCompetition } from "@/components/PublicNav";
import { ThemeProvider } from "@/components/ThemeProvider";
import { UrgentBanner } from "@/components/UrgentBanner";
import { BottomNav } from "@/components/mobile/BottomNav";
import { LiveDrawer, type LiveDrawerMatch } from "@/components/mobile/LiveDrawer";
import { withStoredMatchClocks } from "@/lib/allsports-sync";
import { getUrgentArticle } from "@/lib/featured";
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
import "./editorial.css";
import "./workspace.css";
import "./motion.css";
import { PublicShell } from "@/components/PublicShell";

/**
 * Police du design system (WP9).
 *
 * Inter variable locale (mêmes fichiers et alternantes que Clipmagic) : aucun appel à Google au chargement,
 * aucune requête tierce, et `display: "swap"` évite un texte invisible pendant
 * le téléchargement. La variable `--font-inter` est consommée par
 * tailwind.config.js (fontFamily.sans / fontFamily.display), ce qui permet de
 * changer de police sans toucher aux composants.
 *
 * Les graisses 700/800 servent aux titres : une seule famille suffit, ce qui
 * évite de télécharger une seconde police pour un gain visuel marginal.
 */
const inter = localFont({
  src: [
    { path: "./fonts/Inter-roman.var.woff2", weight: "100 900", style: "normal" },
    { path: "./fonts/Inter-italic.var.woff2", weight: "100 900", style: "italic" },
  ],
  declarations: [{ prop: "font-feature-settings", value: "'salt'" }],
  adjustFontFallback: false,
  display: "swap",
  variable: "--font-inter",
});

/**
 * Police d'affichage pour les gros titres (WP34).
 *
 * Sora est chargée depuis Google Fonts et auto-hébergée au build par Next.js :
 * aucun appel réseau à l'exécution, et `display: "swap"` évite un texte
 * invisible pendant le téléchargement. La variable `--font-sora` est consommée
 * par tailwind.config.js (fontFamily.display) et appliquée aux h1/h2 dans
 * src/app/globals.css.
 */
const sora = Sora({
  weight: ["200", "800"],
  style: "normal",
  display: "swap",
  variable: "--font-sora",
  subsets: ["latin"],
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
 * Fenêtre d'affichage (WP33) : `viewport-fit=cover` expose les zones sûres iOS
 * (`env(safe-area-inset-*)`) auxquelles s'adosse le chrome mobile (barre de
 * navigation, tiroir « EN DIRECT »). Next complète l'entrée par défaut
 * (`width=device-width, initial-scale=1`).
 */
export const viewport: Viewport = { viewportFit: "cover" };

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
 * Article du bandeau urgent, mis en cache une minute.
 *
 * Le bandeau est affiché par le layout sur toutes les pages publiques : la
 * requête ne doit donc pas partir à chaque affichage. Le choix manuel
 * (`/studio/une`) prime sur le repli automatique (dernier FLASH/NEWS publié).
 */
const getCachedUrgentArticle = unstable_cache(
  async () => getUrgentArticle(),
  ["home-urgent"],
  { revalidate: 60 },
);


/**
 * Matchs en direct du tiroir mobile (WP33).
 *
 * Requête volontairement légère (20 matchs maximum, champs d'affichage
 * seulement, logos servis par le proxy WP30) et mise en cache 30 s : le layout
 * est rendu sur toutes les pages publiques. Le tiroir la relit via une Server
 * Action à l'ouverture et se contente de cette relecture — pas de WebSocket.
 *
 * La minute affichée vient de la dernière horloge connue des synchronisations
 * (`withStoredMatchClocks`), sinon du dernier événement du match.
 */
const getLiveMatches = unstable_cache(
  async (): Promise<LiveDrawerMatch[]> => {
    try {
      const matches = await prisma.match.findMany({
        where: { status: "LIVE" },
        orderBy: { scheduledAt: "asc" },
        take: 20,
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          homeScore: true,
          awayScore: true,
          events: {
            orderBy: [{ minute: "desc" }, { extraMinute: "desc" }],
            take: 1,
            select: { minute: true, extraMinute: true, createdAt: true },
          },
          competition: { select: { name: true } },
          homeTeam: { select: { name: true, slug: true, shortName: true, logoUrl: true } },
          awayTeam: { select: { name: true, slug: true, shortName: true, logoUrl: true } },
        },
      });
      const withClocks = await withStoredMatchClocks(
        matches.map((match) => {
          const last = match.events[0];
          return {
            ...match,
            minute: last
              ? `${last.minute}${last.extraMinute ? `+${last.extraMinute}` : ""}′`
              : null,
            minuteObservedAt: last ? last.createdAt.toISOString() : null,
          };
        }),
      );
      return withClocks.map((match) => ({
        id: match.id,
        status: match.status,
        scheduledAt: match.scheduledAt,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        minute: match.minute,
        minuteObservedAt: match.minuteObservedAt,
        minutePeriodEnd: match.minutePeriodEnd,
        competition: match.competition,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
      }));
    } catch (error) {
      console.warn("[mobile] matchs en direct indisponibles :", error);
      return [];
    }
  },
  ["mobile-live-matches"],
  { revalidate: 30 },
);

/**
 * Relecture du tiroir (WP33) : Server Action légère appelée à l'ouverture et
 * par la relecture silencieuse du composant — jamais de flux permanent.
 */
async function getLiveMatchesAction(): Promise<LiveDrawerMatch[]> {
  "use server";
  return getLiveMatches();
}


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [competitions, urgent, liveMatches] = await Promise.all([
    getNavCompetitions().catch(() => []),
    getCachedUrgentArticle().catch(() => null),
    getLiveMatches(),
  ]);

  return (
    <html lang="fr" className={`${inter.variable} ${sora.variable}`} suppressHydrationWarning>
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
          <PublicShell header={<PublicNav
            competitions={competitions}
            urgentBar={urgent ? <UrgentBanner article={urgent} /> : null}
            scoresBar={<AdSlotGate><div className="border-b border-border bg-background px-3 py-3"><AdSlot format="leaderboard" /></div></AdSlotGate>}
          />}>
          {children}
          {/* Chrome mobile (WP33) : barre de navigation fixe et tiroir
              « EN DIRECT », masqués à partir de 768 px et sur les pages
              techniques (chacun porte ses propres exclusions). */}
          <BottomNav />
          <LiveDrawer initialMatches={liveMatches} refreshAction={getLiveMatchesAction} />
          {/* Collecte analytics first-party (WP8d) : un beacon après `load`. */}
          <Analytics />
          </PublicShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
