/**
 * News Engine — collecte des alertes (WP41).
 *
 *   npx tsx scripts/fetch-news.ts
 *   npx tsx scripts/fetch-news.ts --limit=5
 *   npx tsx scripts/fetch-news.ts --source="So Foot"
 *   npx tsx scripts/fetch-news.ts --help
 *
 * En développement, la base Docker locale est joignable via la passerelle
 * WebSocket utilisée par PrismaNeon :
 *
 *   node scripts/check-wp19e.cjs --ws-proxy
 *   NEON_WS_PROXY=127.0.0.1:5443 npm run news:fetch
 *
 * En production, le script utilise Neon directement (aucun proxy).
 * Les sources YouTube nécessitent YOUTUBE_API_KEY dans l'environnement.
 */
export {};

//Capture the caller's database before reading .env, as in sync-football.ts.
const callerDatabaseUrl = process.env.DATABASE_URL;
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional when configuration is supplied by the caller.
} finally {
  if (callerDatabaseUrl !== undefined) process.env.DATABASE_URL = callerDatabaseUrl;
}

type FeedItem = {
  title: string;
  url: string;
  content: string | null;
  publishedAt: Date;
};

const DEFAULT_LIMIT = 10;

function usage(): void {
  console.log(`News Engine — collecte des alertes

Usage :
  npx tsx scripts/fetch-news.ts [options]

Options :
  --limit=<n>       Nombre d'éléments par source (défaut : ${DEFAULT_LIMIT}, max 50)
  --source=<nom|id> Ne traiter qu'une seule source
  --dry-run         Afficher les alertes sans les enregistrer
  --help            Afficher cette aide

Variables :
  YOUTUBE_API_KEY   Requise pour les sources de type YOUTUBE
  NEON_WS_PROXY     Passerelle locale (Docker uniquement, ex. 127.0.0.1:5443)
`);
}

function readOption(args: string[], name: string): string | undefined {
  const withEquals = args.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseLimit(args: string[]): number {
  const raw = readOption(args, "limit");
  if (!raw) return DEFAULT_LIMIT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("--limit doit être un entier supérieur à zéro.");
  }
  return Math.min(value, 50);
}

/** Extrait un identifiant de chaîne depuis une URL YouTube. */
function channelIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const channel = url.pathname.match(/\/channel\/(UC[\w-]+)/i);
    if (channel) return channel[1];
    const query = url.searchParams.get("channel_id");
    return query && /^UC[\w-]+$/.test(query) ? query : null;
  } catch {
    return null;
  }
}

type YouTubeSearchResponse = {
  items?: Array<{
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      description?: string;
      publishedAt?: string;
    };
  }>;
  error?: { message?: string };
};

type YouTubeChannelResponse = {
  items?: Array<{ id?: string }>;
  error?: { message?: string };
};

function youtubeError(payload: { error?: { message?: string } }, status: number): Error {
  return new Error(
    `API YouTube (${status}) : ${payload.error?.message ?? "réponse invalide"}`,
  );
}

/** Résout un identifiant de chaîne, y compris pour une URL /@handle. */
async function resolveChannelId(sourceUrl: string, apiKey: string): Promise<string> {
  const direct = channelIdFromUrl(sourceUrl);
  if (direct) return direct;

  const url = new URL(sourceUrl);
  const handle = url.pathname.match(/^\/@([^/]+)/)?.[1];
  if (!handle) {
    throw new Error(
      "URL YouTube non reconnue : utilisez https://www.youtube.com/channel/UC… ou /@handle.",
    );
  }

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/channels");
  endpoint.search = new URLSearchParams({
    part: "id",
    forHandle: `@${handle}`,
    key: apiKey,
  }).toString();

  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
  const payload = (await response.json()) as YouTubeChannelResponse;
  if (!response.ok) throw youtubeError(payload, response.status);

  const id = payload.items?.[0]?.id;
  if (!id) throw new Error(`Chaîne YouTube introuvable pour @${handle}.`);
  return id;
}

function cleanDescription(value: string | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
  return text || null;
}

/** Récupère les dernières vidéos d'une chaîne via YouTube Data API v3. */
async function fetchYouTubeItems(
  sourceUrl: string,
  limit: number,
  apiKey: string,
): Promise<FeedItem[]> {
  const channelId = await resolveChannelId(sourceUrl, apiKey);
  const endpoint = new URL("https://www.googleapis.com/youtube/v3/search");
  endpoint.search = new URLSearchParams({
    part: "snippet",
    channelId,
    order: "date",
    type: "video",
    maxResults: String(limit),
    key: apiKey,
  }).toString();

  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) });
  const payload = (await response.json()) as YouTubeSearchResponse;
  if (!response.ok) throw youtubeError(payload, response.status);

  const items: FeedItem[] = [];
  for (const item of payload.items ?? []) {
    const videoId = item.id?.videoId;
    const title = item.snippet?.title?.trim();
    if (!videoId || !title) continue;
    const published = item.snippet?.publishedAt
      ? new Date(item.snippet.publishedAt)
      : new Date();
    items.push({
      title: title.slice(0, 300),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      content: cleanDescription(item.snippet?.description),
      publishedAt: Number.isNaN(published.getTime()) ? new Date() : published,
    });
  }

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, limit);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    usage();
    return;
  }

  const limit = parseLimit(args);
  const sourceFilter = readOption(args, "source")?.trim();
  const dryRun = args.includes("--dry-run");

  const [{ prisma }, { fetchRssItems }] = await Promise.all([
    import("../src/lib/prisma"),
    import("../src/lib/rss"),
  ]);

  try {
    const sources = await prisma.newsSource.findMany({
      where: {
        active: true,
        ...(sourceFilter
          ? {
              OR: [
                { id: sourceFilter },
                { name: { equals: sourceFilter, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    if (sources.length === 0) {
      console.log(
        sourceFilter
          ? `[veille] Aucune source active ne correspond à « ${sourceFilter} ».`
          : "[veille] Aucune source active. Ajoutez une NewsSource en base.",
      );
      return;
    }

    const youtubeKey = process.env.YOUTUBE_API_KEY?.trim();
    let created = 0;
    let received = 0;
    let failures = 0;

    for (const source of sources) {
      try {
        let items: FeedItem[];
        if (source.type === "RSS") {
          items = await fetchRssItems(source.url, limit);
        } else {
          if (!youtubeKey) {
            throw new Error("YOUTUBE_API_KEY absente de l'environnement.");
          }
          items = await fetchYouTubeItems(source.url, limit, youtubeKey);
        }

        received += items.length;

        const urls = items.map((item) => item.url);
        const existing = await prisma.newsAlert.findMany({
          where: { sourceId: source.id, url: { in: urls } },
          select: { url: true },
        });
        const known = new Set(existing.map((alert) => alert.url));
        const fresh = items.filter((item) => !known.has(item.url));

        if (!dryRun && fresh.length > 0) {
          const result = await prisma.newsAlert.createMany({
            data: fresh.map((item) => ({
              sourceId: source.id,
              title: item.title,
              url: item.url,
              content: item.content,
              publishedAt: item.publishedAt,
            })),
            skipDuplicates: true,
          });
          created += result.count;
        } else {
          created += fresh.length;
        }

        console.log(
          `[veille] ${source.name} (${source.type}) : ${items.length} reçue(s), ` +
            `${fresh.length} nouvelle(s)${dryRun ? " (dry-run, non enregistrées)" : ""}.`,
        );
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[veille] ÉCHEC ${source.name} : ${message}`);
      }
    }

    console.log(
      `[veille] ${sources.length} source(s), ${received} élément(s) récupéré(s), ` +
        `${created} alerte(s) ${dryRun ? "détectée(s)" : "créée(s)"}.`,
    );

    if (failures === sources.length) {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[veille] Erreur fatale :", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
