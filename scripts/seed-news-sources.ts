/**
 * News Engine — sources de veille (WP41).
 *
 *   npm run news:seed
 *
 * Installe ou réactive la liste des grands médias sportifs internationaux, des
 * sites officiels de clubs et d'instances, et des comptes sociaux de référence.
 * Les sources X, Facebook et Instagram sont préremplies avec les API
 * officielles ; leur collecte nécessite les tokens X_BEARER_TOKEN,
 * META_ACCESS_TOKEN et META_IG_USER_ID. Les sources existantes sont mises à
 * jour par URL ; aucune alerte n'est supprimée. Le script est idempotent.
 *
 * Les sites officiels portent `isOfficial: true`. Les types FLASHSCORE,
 * SITEMAP, OFFICIAL_SITE, JSON et MANUAL sont lus par les connecteurs dédiés de
 * src/lib/. Un site sans flux ni structure exploitable reste en MANUAL : il est
 * référencé dans le backoffice, sans collecte automatique.
 */
export {};

const callerDatabaseUrl = process.env.DATABASE_URL;
try {
  process.loadEnvFile?.();
} catch {
  // .env facultatif si la configuration vient du shell.
} finally {
  if (callerDatabaseUrl !== undefined) process.env.DATABASE_URL = callerDatabaseUrl;
}

type SeedSourceType =
  | "RSS"
  | "YOUTUBE"
  | "BLUESKY"
  | "MASTODON"
  | "REDDIT"
  | "X"
  | "FACEBOOK"
  | "INSTAGRAM"
  | "SOCIAL"
  | "FLASHSCORE"
  | "SITEMAP"
  | "OFFICIAL_SITE"
  | "JSON"
  | "MANUAL";

type SeedSource = {
  name: string;
  url: string;
  type?: SeedSourceType;
  isOfficial?: boolean;
};

const SOURCES: SeedSource[] = [
  // France
  { name: "So Foot", url: "https://www.sofoot.com/rss" },
  { name: "RMC Sport", url: "https://rmcsport.bfmtv.com/rss/fil-sport/" },
  { name: "Le Monde Sport", url: "https://www.lemonde.fr/sport/rss_full.xml" },

  // Royaume-Uni
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml" },
  { name: "The Guardian Sport", url: "https://www.theguardian.com/uk/sport/rss" },
  { name: "Sky Sports Football", url: "https://www.skysports.com/rss/12040" },
  { name: "talkSPORT", url: "https://talksport.com/feed/" },

  // États-Unis
  { name: "ESPN", url: "https://www.espn.com/espn/rss/news" },
  { name: "CBS Sports", url: "https://www.cbssports.com/rss/headlines/" },

  // Espagne
  { name: "Marca", url: "https://www.marca.com/rss/futbol.xml" },
  { name: "Mundo Deportivo", url: "https://www.mundodeportivo.com/rss/futbol.xml" },

  // Amérique latine
  { name: "Olé", url: "https://www.ole.com.ar/rss/" },
  { name: "Clarín Deportes", url: "https://www.clarin.com/rss/deportes/" },

  // Italie
  {
    name: "Corriere dello Sport",
    url: "https://www.corrieredellosport.it/rss/",
  },

  // Allemagne
  { name: "Kicker", url: "https://newsfeed.kicker.de/news/aktuell" },
  { name: "DW Sports", url: "https://rss.dw.com/rdf/rss-en-sports" },

  // Portugal
  { name: "Record", url: "https://www.record.pt/rss" },

  // Brésil
  { name: "Globo Esporte", url: "https://ge.globo.com/rss/ge/" },

  // Inde
  {
    name: "Times of India Sport",
    url: "https://timesofindia.indiatimes.com/rssfeeds/4719148.cms",
  },

  // Océanie
  { name: "SMH Sport", url: "https://www.smh.com.au/rss/sport.xml" },

  // Asie
  { name: "SCMP Sport", url: "https://www.scmp.com/rss/95/feed" },

  // Flashscore — média, pas une source officielle.
  {
    name: "Flashscore Actualités",
    url: "https://www.flashscore.fr/actualites/",
    type: "FLASHSCORE",
  },

  // Instances officielles : fédérations, ligues et confédérations.
  { name: "FFF", url: "https://www.fff.fr/", type: "OFFICIAL_SITE", isOfficial: true },
  { name: "UEFA", url: "https://www.uefa.com/", type: "OFFICIAL_SITE", isOfficial: true },
  {
    name: "FIFA",
    url: "https://inside.fifa.com/sitemaps/articles/0",
    type: "SITEMAP",
    isOfficial: true,
  },
  {
    name: "Ligue 1",
    url: "https://ligue1.com/api/sitemap/sitemap-articles-l1-fr",
    type: "SITEMAP",
    isOfficial: true,
  },
  {
    name: "Premier League",
    url: "https://www.premierleague.com/en/sitemap/news.xml",
    type: "SITEMAP",
    isOfficial: true,
  },
  {
    name: "LaLiga",
    url: "https://www.laliga.com/en-GB/news",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "Serie A",
    url: "https://en.legaseriea.it/news",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "Bundesliga",
    url: "https://www.bundesliga.com/rss/en/rss-news.rss",
    isOfficial: true,
  },
  { name: "CONMEBOL", url: "https://www.conmebol.com/feed/", isOfficial: true },
  {
    name: "CONCACAF",
    url: "https://www.concacaf.com/news",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "CAF",
    url: "https://www.cafonline.com/umbraco/api/Article/News?contextId=-1&itemsPerPage=20&pageNumber=1&culture=en-GB",
    type: "JSON",
    isOfficial: true,
  },
  { name: "AFC", url: "https://www.the-afc.com/rss", isOfficial: true },
  { name: "OFC", url: "https://www.oceaniafootball.com/feed/", isOfficial: true },

  // Clubs de Ligue 1 — sites officiels.
  {
    name: "Paris Saint-Germain",
    url: "https://www.psg.fr/en/news",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "Olympique de Marseille",
    url: "https://www.om.fr/news-sitemap.xml",
    type: "SITEMAP",
    isOfficial: true,
  },
  {
    name: "AS Monaco",
    url: "https://www.asmonaco.com/fr/news",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "Lille OSC",
    url: "https://www.losc.fr/actualites",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "RC Lens",
    url: "https://www.rclens.fr/fr/news",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "Stade Rennais",
    url: "https://www.staderennais.com/main/sitemap.xml?page=17",
    type: "SITEMAP",
    isOfficial: true,
  },
  {
    name: "OGC Nice",
    url: "https://www.ogcnice.com/fr/rubrique",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "RC Strasbourg",
    url: "https://www.rcstrasbourgalsace.fr/feed/",
    isOfficial: true,
  },
  {
    name: "Olympique Lyonnais",
    url: "https://www.ol.fr/fr/actualites",
    type: "MANUAL",
    isOfficial: true,
  },
  {
    name: "Stade Brestois",
    url: "https://www.sb29.bzh/default/feeds/actualite_fr_FR.rss",
    isOfficial: true,
  },
  {
    name: "Toulouse FC",
    url: "https://www.toulousefc.com/equipes/equipe-professionnelle/actualite",
    type: "MANUAL",
    isOfficial: true,
  },
  { name: "AJ Auxerre", url: "https://www.aja.fr/feed/", isOfficial: true },
  {
    name: "Angers SCO",
    url: "https://angers-sco.fr/actualites/",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  {
    name: "Le Havre AC",
    url: "https://hac.football/fr/posts",
    type: "OFFICIAL_SITE",
    isOfficial: true,
  },
  { name: "FC Lorient", url: "https://www.fclorient.bzh/feed/", isOfficial: true },
  { name: "Paris FC", url: "https://parisfc.fr/feed/", isOfficial: true },
  {
    name: "Le Mans FC",
    url: "https://www.lemansfc.fr/",
    type: "MANUAL",
    isOfficial: true,
  },
  { name: "ES Troyes AC", url: "https://www.estac.fr/actualites/feed/", isOfficial: true },

  // Réseaux sociaux
  {
    name: "The Athletic Football (Bluesky)",
    url: "https://bsky.app/profile/theathleticfc.bsky.social",
    type: "BLUESKY",
  },
  {
    name: "ESPN (Mastodon miroir)",
    url: "https://mastodon.social/@espn@sportsbots.xyz",
    type: "MASTODON",
  },
  {
    name: "r/soccer (Reddit)",
    url: "https://www.reddit.com/r/soccer/",
    type: "REDDIT",
  },
  {
    name: "Sky Sports Football (YouTube)",
    url: "https://www.youtube.com/@SkySportsFootball",
    type: "YOUTUBE",
  },

  // X, Facebook, Instagram — API officielles (tokens requis).
  // Les sources sont préremplies ; la collecte démarre dès que les variables
  // X_BEARER_TOKEN, META_ACCESS_TOKEN et META_IG_USER_ID sont configurées.
  { name: "ESPN (X)", url: "https://x.com/espn", type: "X" },
  { name: "The Athletic Football (X)", url: "https://x.com/TheAthleticFC", type: "X" },
  { name: "Sky Sports News (X)", url: "https://x.com/SkySportsNews", type: "X" },
  { name: "Fabrizio Romano (X)", url: "https://x.com/FabrizioRomano", type: "X" },
  { name: "ESPN (Facebook)", url: "https://www.facebook.com/espn", type: "FACEBOOK" },
  { name: "The Athletic (Facebook)", url: "https://www.facebook.com/theathletic", type: "FACEBOOK" },
  { name: "Sky Sports (Facebook)", url: "https://www.facebook.com/skysports", type: "FACEBOOK" },
  { name: "ESPN (Instagram)", url: "https://www.instagram.com/espn", type: "INSTAGRAM" },
  { name: "The Athletic (Instagram)", url: "https://www.instagram.com/theathletic", type: "INSTAGRAM" },
  { name: "Sky Sports (Instagram)", url: "https://www.instagram.com/skysports", type: "INSTAGRAM" },
  { name: "Fabrizio Romano (Instagram)", url: "https://www.instagram.com/fabrizioromano", type: "INSTAGRAM" },
];

async function main(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  const missingTokens = [
    !process.env.X_BEARER_TOKEN?.trim() ? "X_BEARER_TOKEN" : null,
    !process.env.META_ACCESS_TOKEN?.trim() ? "META_ACCESS_TOKEN" : null,
    !process.env.META_IG_USER_ID?.trim() ? "META_IG_USER_ID" : null,
  ].filter((value): value is string => Boolean(value));

  if (missingTokens.length > 0) {
    console.warn(
      `[veille] Tokens manquants (${missingTokens.join(", ")}) : les sources ` +
        "X/Facebook/Instagram seront préremplies mais échoueront à la collecte " +
        "jusqu'à leur configuration.",
    );
  }

  let created = 0;
  let updated = 0;

  try {
    for (const source of SOURCES) {
      const existing = await prisma.newsSource.findUnique({
        where: { url: source.url },
        select: { id: true },
      });
      const type = source.type ?? "RSS";
      const isOfficial = source.isOfficial ?? false;

      await prisma.newsSource.upsert({
        where: { url: source.url },
        update: { name: source.name, type, active: true, isOfficial },
        create: { name: source.name, type, url: source.url, active: true, isOfficial },
      });

      if (existing) updated += 1;
      else created += 1;
    }

    console.log(
      `[veille] ${SOURCES.length} source(s) configurée(s) : ` +
        `${created} créée(s), ${updated} mise(s) à jour.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    "[veille] Erreur fatale :",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
