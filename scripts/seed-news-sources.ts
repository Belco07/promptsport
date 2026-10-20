/**
 * News Engine — sources de veille (WP41).
 *
 *   npm run news:seed
 *
 * Installe ou réactive la liste des grands médias sportifs internationaux et
 * des comptes sociaux de référence. Les sources existantes sont mises à jour
 * par URL ; aucune alerte n'est supprimée. Le script est idempotent.
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
  | "SOCIAL";

type SeedSource = {
  name: string;
  url: string;
  type?: SeedSourceType;
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
];

async function main(): Promise<void> {
  const { prisma } = await import("../src/lib/prisma");
  let created = 0;
  let updated = 0;

  try {
    for (const source of SOURCES) {
      const existing = await prisma.newsSource.findUnique({
        where: { url: source.url },
        select: { id: true },
      });
      const type = source.type ?? "RSS";

      await prisma.newsSource.upsert({
        where: { url: source.url },
        update: { name: source.name, type, active: true },
        create: { name: source.name, type, url: source.url, active: true },
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
