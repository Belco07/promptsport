/**
 * News Engine — sources de veille (WP41).
 *
 *   npm run news:seed
 *
 * Installe ou réactive la liste des grands médias sportifs internationaux, des
 * sites officiels de clubs et d'instances, et des comptes sociaux officiels des
 * instances, des 18 clubs de Ligue 1 et des principales personnalités du
 * football. Les sources X, Facebook, Instagram et YouTube sont préremplies avec
 * les API officielles ; leur collecte nécessite X_BEARER_TOKEN,
 * META_ACCESS_TOKEN, META_IG_USER_ID et YOUTUBE_API_KEY. Tant qu'un identifiant
 * manque, les sources concernées restent en base mais sont désactivées : elles
 * ne provoquent pas d'échec de collecte. Les sources existantes sont mises à
 * jour par URL ; aucune alerte n'est supprimée. Le script est idempotent.
 *
 * Les sites officiels et les comptes officiels portent `isOfficial: true`. Les
 * types FLASHSCORE, SITEMAP, OFFICIAL_SITE, JSON et MANUAL sont lus par les
 * connecteurs dédiés de src/lib/. Un site sans flux ni structure exploitable
 * reste en MANUAL : il est référencé dans le backoffice, sans collecte
 * automatique.
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

type SeedSourceToken = "x" | "facebook" | "instagram" | "youtube";

type SeedSource = {
  name: string;
  url: string;
  type?: SeedSourceType;
  isOfficial?: boolean;
  /// Source désactivée tant que la variable d'environnement correspondante manque.
  requiresToken?: SeedSourceToken;
};

type OfficialSocialAccount = {
  name: string;
  x?: string;
  facebook?: string;
  instagram?: string;
  youtube?: string;
};

const SOCIAL_PLATFORMS: ReadonlyArray<{
  key: "x" | "facebook" | "instagram" | "youtube";
  label: string;
  type: SeedSourceType;
  requiresToken: SeedSourceToken;
}> = [
  { key: "x", label: "X", type: "X", requiresToken: "x" },
  { key: "facebook", label: "Facebook", type: "FACEBOOK", requiresToken: "facebook" },
  { key: "instagram", label: "Instagram", type: "INSTAGRAM", requiresToken: "instagram" },
  { key: "youtube", label: "YouTube", type: "YOUTUBE", requiresToken: "youtube" },
];

function officialSocialSources(accounts: OfficialSocialAccount[]): SeedSource[] {
  const sources: SeedSource[] = [];
  for (const account of accounts) {
    for (const platform of SOCIAL_PLATFORMS) {
      const url = account[platform.key];
      if (!url) continue;
      sources.push({
        name: `${account.name} (${platform.label})`,
        url,
        type: platform.type,
        isOfficial: true,
        requiresToken: platform.requiresToken,
      });
    }
  }
  return sources;
}

const OFFICIAL_SOCIAL_ACCOUNTS: OfficialSocialAccount[] = [
  // Instances.
  {
    name: "FFF",
    x: "https://x.com/FFF",
    facebook: "https://www.facebook.com/fff",
    instagram: "https://www.instagram.com/fff",
    youtube: "https://www.youtube.com/@FFF",
  },
  {
    name: "UEFA",
    x: "https://x.com/UEFA",
    facebook: "https://www.facebook.com/uefa",
    instagram: "https://www.instagram.com/uefa",
    youtube: "https://www.youtube.com/@UEFA",
  },
  {
    name: "FIFA",
    x: "https://x.com/FIFA",
    facebook: "https://www.facebook.com/fifa",
    instagram: "https://www.instagram.com/fifa",
    youtube: "https://www.youtube.com/@FIFA",
  },
  {
    name: "Ligue 1",
    x: "https://x.com/Ligue1",
    facebook: "https://www.facebook.com/Ligue1",
    instagram: "https://www.instagram.com/ligue1mcdonalds",
    youtube: "https://www.youtube.com/@Ligue1",
  },
  {
    name: "Premier League",
    x: "https://x.com/premierleague",
    facebook: "https://www.facebook.com/premierleague",
    instagram: "https://www.instagram.com/premierleague",
    youtube: "https://www.youtube.com/@premierleague",
  },
  {
    name: "LaLiga",
    x: "https://x.com/LaLigaEN",
    facebook: "https://www.facebook.com/LaLiga",
    instagram: "https://www.instagram.com/laliga",
    youtube: "https://www.youtube.com/@LaLiga",
  },
  {
    name: "Serie A",
    x: "https://x.com/SerieA_EN",
    facebook: "https://www.facebook.com/SerieA",
    instagram: "https://www.instagram.com/seriea",
    youtube: "https://www.youtube.com/@SerieA",
  },
  {
    name: "Bundesliga",
    x: "https://x.com/bundesliga_EN",
    facebook: "https://www.facebook.com/BundesligaOfficial",
    instagram: "https://www.instagram.com/bundesliga",
    youtube: "https://www.youtube.com/@bundesliga",
  },
  {
    name: "AFC",
    facebook: "https://www.facebook.com/theafc",
    instagram: "https://www.instagram.com/theafc",
    youtube: "https://www.youtube.com/@theafc",
  },
  {
    name: "CAF",
    x: "https://x.com/CAF_Online",
    facebook: "https://www.facebook.com/ConfederationAfricaineDeFootball",
    instagram: "https://www.instagram.com/caf_online",
    youtube: "https://www.youtube.com/channel/UCr5K057x3mHroPHsNk9OiwA",
  },
  {
    name: "CONCACAF",
    x: "https://x.com/Concacaf",
    facebook: "https://www.facebook.com/concacaf",
    instagram: "https://www.instagram.com/concacaf",
    youtube: "https://www.youtube.com/@concacaf",
  },
  {
    name: "CONMEBOL",
    x: "https://x.com/CONMEBOL",
    facebook: "https://www.facebook.com/CONMEBOL",
    instagram: "https://www.instagram.com/conmebol",
    youtube: "https://www.youtube.com/@CONMEBOL",
  },
  {
    name: "OFC",
    x: "https://x.com/OFCfootball",
    facebook: "https://www.facebook.com/OFCfootball",
    instagram: "https://www.instagram.com/ofcfootball",
    youtube: "https://www.youtube.com/@OFCfootball",
  },

  // Clubs de Ligue 1.
  {
    name: "Paris Saint-Germain",
    x: "https://x.com/PSG_inside",
    facebook: "https://www.facebook.com/PSG",
    instagram: "https://www.instagram.com/psg",
    youtube: "https://www.youtube.com/@PSG",
  },
  {
    name: "Olympique de Marseille",
    x: "https://x.com/OM_Officiel",
    facebook: "https://www.facebook.com/OM",
    instagram: "https://www.instagram.com/olympiquedemarseille",
    youtube: "https://www.youtube.com/@om_officiel",
  },
  {
    name: "AS Monaco",
    x: "https://x.com/AS_Monaco",
    facebook: "https://www.facebook.com/asmonaco",
    instagram: "https://www.instagram.com/asmonaco",
    youtube: "https://www.youtube.com/@ASMonaco",
  },
  {
    name: "Lille OSC",
    x: "https://x.com/losclive",
    facebook: "https://www.facebook.com/Losc",
    instagram: "https://www.instagram.com/losclive",
    youtube: "https://www.youtube.com/@LOSC",
  },
  {
    name: "RC Lens",
    x: "https://x.com/RCLens",
    facebook: "https://www.facebook.com/RCLens",
    instagram: "https://www.instagram.com/rclens",
    youtube: "https://www.youtube.com/@rclens",
  },
  {
    name: "Stade Rennais",
    x: "https://x.com/staderennais",
    facebook: "https://www.facebook.com/staderennais",
    instagram: "https://www.instagram.com/staderennaisfc",
    youtube: "https://www.youtube.com/channel/UC96bdUrtQVEqx_OmKwFAgXg",
  },
  {
    name: "OGC Nice",
    x: "https://x.com/ogcnice",
    facebook: "https://www.facebook.com/ogcnice",
    instagram: "https://www.instagram.com/ogcnice",
    youtube: "https://www.youtube.com/@OGCNice",
  },
  {
    name: "RC Strasbourg",
    x: "https://x.com/RCSA",
    facebook: "https://www.facebook.com/RCSAOfficiel",
    instagram: "https://www.instagram.com/rcsa",
    youtube: "https://www.youtube.com/channel/UCfxu0LuxvMKtHjPX9faYVpg",
  },
  {
    name: "Olympique Lyonnais",
    x: "https://x.com/OL",
    facebook: "https://www.facebook.com/OlympiqueLyonnais",
    instagram: "https://www.instagram.com/ol",
    youtube: "https://www.youtube.com/channel/UCzHCZXmqIdjqRnpdp0l_T6g",
  },
  {
    name: "Stade Brestois",
    x: "https://x.com/SB29",
    facebook: "https://www.facebook.com/sb29off",
    instagram: "https://www.instagram.com/stadebrestois29",
  },
  {
    name: "Toulouse FC",
    x: "https://x.com/ToulouseFC",
    facebook: "https://www.facebook.com/ToulouseFC",
    instagram: "https://www.instagram.com/toulousefc",
    youtube: "https://www.youtube.com/@ToulouseFC",
  },
  {
    name: "AJ Auxerre",
    x: "https://x.com/AJA",
    facebook: "https://www.facebook.com/ajaofficiel",
    instagram: "https://www.instagram.com/aja",
  },
  {
    name: "Angers SCO",
    x: "https://x.com/angerssco",
    facebook: "https://www.facebook.com/AngersSCO",
    instagram: "https://www.instagram.com/angers_sco",
    youtube: "https://www.youtube.com/@AngersSCOYTB",
  },
  {
    name: "Le Havre AC",
    x: "https://x.com/HAC_Foot",
    facebook: "https://www.facebook.com/HavreACFOOT",
    instagram: "https://www.instagram.com/hac_foot",
    youtube: "https://www.youtube.com/channel/UC-nrAHj3e6bywZ1SIr5UUOQ",
  },
  {
    name: "FC Lorient",
    x: "https://x.com/FCLorient",
    facebook: "https://www.facebook.com/FC-Lorient-129677837090824",
    instagram: "https://www.instagram.com/fclorient",
    youtube: "https://www.youtube.com/channel/UC1LeTxFgKYwMeQjRjLyGRTQ",
  },
  {
    name: "Paris FC",
    x: "https://x.com/ParisFC",
    facebook: "https://www.facebook.com/parisfc",
    instagram: "https://www.instagram.com/parisfc",
    youtube: "https://www.youtube.com/@parisfc",
  },
  {
    name: "Le Mans FC",
    x: "https://x.com/LEMANSFC",
    facebook: "https://www.facebook.com/LEMANSFCOfficiel",
    instagram: "https://www.instagram.com/lemansfc.officiel",
  },
  {
    name: "ES Troyes AC",
    x: "https://x.com/estac_officiel",
    facebook: "https://www.facebook.com/ESTAC.OFFICIEL",
    instagram: "https://www.instagram.com/estac_troyes",
    youtube: "https://www.youtube.com/@ESTAC",
  },

  // Personnalités et stars du football.
  {
    name: "Lamine Yamal",
    x: "https://x.com/LamineYamal",
    instagram: "https://www.instagram.com/lamineyamal",
    youtube: "https://www.youtube.com/@LamineYamal",
  },
  {
    name: "Kylian Mbappé",
    x: "https://x.com/KMbappe",
    instagram: "https://www.instagram.com/k.mbappe",
  },
  {
    name: "Cristiano Ronaldo",
    x: "https://x.com/Cristiano",
    instagram: "https://www.instagram.com/cristiano",
    youtube: "https://www.youtube.com/@cristiano",
  },
  {
    name: "Lionel Messi",
    x: "https://x.com/TeamMessi",
    instagram: "https://www.instagram.com/leomessi",
    youtube: "https://www.youtube.com/@leomessi",
  },
  {
    name: "Neymar Jr",
    x: "https://x.com/neymarjr",
    instagram: "https://www.instagram.com/neymarjr",
    youtube: "https://www.youtube.com/@neymarjr",
  },
  {
    name: "Erling Haaland",
    instagram: "https://www.instagram.com/erling.haaland",
  },
  {
    name: "Vinícius Júnior",
    x: "https://x.com/vinijr",
    instagram: "https://www.instagram.com/vinijr",
    youtube: "https://www.youtube.com/@vinijr",
  },
  {
    name: "Jude Bellingham",
    x: "https://x.com/BellinghamJude",
    instagram: "https://www.instagram.com/judebellingham",
  },
  {
    name: "Mohamed Salah",
    x: "https://x.com/MoSalah",
    instagram: "https://www.instagram.com/mosalah",
  },
  {
    name: "Robert Lewandowski",
    x: "https://x.com/lewy_official",
    instagram: "https://www.instagram.com/_rl9",
  },
  {
    name: "Antoine Griezmann",
    x: "https://x.com/AntoGriezmann",
    instagram: "https://www.instagram.com/antogriezmann",
  },
  {
    name: "Ousmane Dembélé",
    x: "https://x.com/Dembouz",
    instagram: "https://www.instagram.com/ousmanedembele",
  },
  {
    name: "Harry Kane",
    x: "https://x.com/HKane",
    instagram: "https://www.instagram.com/harrykane",
  },
  {
    name: "Alexia Putellas",
    x: "https://x.com/alexiaputellas",
    instagram: "https://www.instagram.com/alexiaputellas",
  },
  {
    name: "Aitana Bonmatí",
    x: "https://x.com/AitanaBonmati",
    instagram: "https://www.instagram.com/aitana.bonmati",
  },
  {
    name: "Marta",
    instagram: "https://www.instagram.com/martamosquita",
  },
];

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
    requiresToken: "youtube",
  },

  // X, Facebook, Instagram — API officielles (tokens requis).
  // Les sources sont préremplies ; la collecte démarre dès que les variables
  // X_BEARER_TOKEN, META_ACCESS_TOKEN et META_IG_USER_ID sont configurées.
  { name: "ESPN (X)", url: "https://x.com/espn", type: "X", requiresToken: "x" },
  { name: "The Athletic Football (X)", url: "https://x.com/TheAthleticFC", type: "X", requiresToken: "x" },
  { name: "Sky Sports News (X)", url: "https://x.com/SkySportsNews", type: "X", requiresToken: "x" },
  { name: "Fabrizio Romano (X)", url: "https://x.com/FabrizioRomano", type: "X", requiresToken: "x" },
  { name: "ESPN (Facebook)", url: "https://www.facebook.com/espn", type: "FACEBOOK", requiresToken: "facebook" },
  { name: "The Athletic (Facebook)", url: "https://www.facebook.com/theathletic", type: "FACEBOOK", requiresToken: "facebook" },
  { name: "Sky Sports (Facebook)", url: "https://www.facebook.com/skysports", type: "FACEBOOK", requiresToken: "facebook" },
  { name: "ESPN (Instagram)", url: "https://www.instagram.com/espn", type: "INSTAGRAM", requiresToken: "instagram" },
  { name: "The Athletic (Instagram)", url: "https://www.instagram.com/theathletic", type: "INSTAGRAM", requiresToken: "instagram" },
  { name: "Sky Sports (Instagram)", url: "https://www.instagram.com/skysports", type: "INSTAGRAM", requiresToken: "instagram" },
  { name: "Fabrizio Romano (Instagram)", url: "https://www.instagram.com/fabrizioromano", type: "INSTAGRAM", requiresToken: "instagram" },

  // Comptes officiels des instances, des clubs et des personnalités.
  ...officialSocialSources(OFFICIAL_SOCIAL_ACCOUNTS),
];

async function main(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  const tokenReady: Record<SeedSourceToken, boolean> = {
    x: Boolean(process.env.X_BEARER_TOKEN?.trim()),
    facebook: Boolean(process.env.META_ACCESS_TOKEN?.trim()),
    instagram: Boolean(
      process.env.META_ACCESS_TOKEN?.trim() &&
        process.env.META_IG_USER_ID?.trim(),
    ),
    youtube: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
  };
  const missingTokens = [
    !tokenReady.x ? "X_BEARER_TOKEN" : null,
    !tokenReady.facebook ? "META_ACCESS_TOKEN" : null,
    !process.env.META_IG_USER_ID?.trim() ? "META_IG_USER_ID" : null,
    !tokenReady.youtube ? "YOUTUBE_API_KEY" : null,
  ].filter((value): value is string => Boolean(value));

  if (missingTokens.length > 0) {
    console.warn(
      `[veille] Accès manquants (${missingTokens.join(", ")}) : ` +
        "les sources concernées sont conservées mais désactivées jusqu'à leur configuration.",
    );
  }

  let created = 0;
  let updated = 0;
  let inactive = 0;
  const seenUrls = new Set<string>();

  try {
    for (const source of SOURCES) {
      if (seenUrls.has(source.url)) {
        throw new Error(`URL dupliquée dans le seed : ${source.url}`);
      }
      seenUrls.add(source.url);

      const existing = await prisma.newsSource.findUnique({
        where: { url: source.url },
        select: { id: true },
      });
      const type = source.type ?? "RSS";
      const isOfficial = source.isOfficial ?? false;
      const active = source.requiresToken
        ? tokenReady[source.requiresToken]
        : true;
      if (!active) inactive += 1;

      await prisma.newsSource.upsert({
        where: { url: source.url },
        update: { name: source.name, type, active, isOfficial },
        create: { name: source.name, type, url: source.url, active, isOfficial },
      });

      if (existing) updated += 1;
      else created += 1;
    }

    console.log(
      `[veille] ${SOURCES.length} source(s) configurée(s) : ` +
        `${created} créée(s), ${updated} mise(s) à jour, ` +
        `${inactive} en attente de token.`,
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
