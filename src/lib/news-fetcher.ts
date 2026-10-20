import { prisma } from "@/lib/prisma";
import { fetchRssItems, type FeedItem } from "@/lib/rss";
import { fetchBlueskyItems, fetchMastodonItems, redditFeedUrl } from "@/lib/social";
import { fetchFacebookItems, fetchInstagramItems, fetchXItems } from "@/lib/social-platforms";
import { isAiConfigured, translateTitlesToFrench } from "@/lib/ai";
import { cleanupOldNewsAlerts, isRecentNewsItem, purgeIgnoredNewsAlerts } from "@/lib/news";

export type NewsFetchOptions = {
  limit?: number;
  source?: string;
  dryRun?: boolean;
  /** Le cron borne les appels concurrents ; le CLI reste séquentiel par défaut. */
  concurrency?: number;
};

export type NewsFetchResult = {
  alertsCreated: number;
  itemsReceived: number;
  sourcesProcessed: number;
  sourcesFailed: number;
};

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

/** Collecte partagée par le CLI et le cron. Ne ferme jamais le singleton Prisma. */
export async function fetchNews(options: NewsFetchOptions = {}): Promise<NewsFetchResult> {
  const requested = options.limit ?? 3;
  if (!Number.isFinite(requested) || requested < 1) throw new Error("La limite doit être un nombre positif.");
  const limit = Math.min(Math.floor(requested), 50);
  const sourceFilter = options.source?.trim();
  const dryRun = options.dryRun ?? false;
  const concurrency = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 1) || 1));
  if (!dryRun) {
    const ignored = await purgeIgnoredNewsAlerts();
    if (ignored > 0) {
      console.log(`[veille] ${ignored} alerte(s) ignorée(s) purgée(s).`);
    }
    const removed = await cleanupOldNewsAlerts();
    if (removed > 0) {
      console.log(`[veille] ${removed} alerte(s) de plus de 48 h supprimée(s).`);
    }
  }

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
    return { alertsCreated: 0, itemsReceived: 0, sourcesProcessed: 0, sourcesFailed: 0 };
  }

  const youtubeKey = process.env.YOUTUBE_API_KEY?.trim();
  const xToken = process.env.X_BEARER_TOKEN?.trim();
  const metaToken = process.env.META_ACCESS_TOKEN?.trim();
  const instagramUserId = process.env.META_IG_USER_ID?.trim();
  let created = 0;
  let received = 0;
  let failures = 0;

  const collectSource = async (source: (typeof sources)[number]): Promise<void> => {
    try {
      let items: FeedItem[];
      switch (source.type) {
        case "RSS":
        case "SOCIAL":
          items = await fetchRssItems(source.url, limit);
          break;
        case "YOUTUBE":
          if (!youtubeKey) {
            throw new Error("YOUTUBE_API_KEY absente de l'environnement.");
          }
          items = await fetchYouTubeItems(source.url, limit, youtubeKey);
          break;
        case "BLUESKY":
          items = await fetchBlueskyItems(source.url, limit);
          break;
        case "MASTODON":
          items = await fetchMastodonItems(source.url, limit);
          break;
        case "REDDIT":
          items = await fetchRssItems(redditFeedUrl(source.url), limit);
          break;
        case "X":
          if (!xToken) {
            throw new Error(
              "X_BEARER_TOKEN absente de l'environnement : la source X ne peut pas être interrogée.",
            );
          }
          items = await fetchXItems(source.url, limit, xToken);
          break;
        case "FACEBOOK":
          if (!metaToken) {
            throw new Error(
              "META_ACCESS_TOKEN absente de l'environnement : la source Facebook ne peut pas être interrogée.",
            );
          }
          items = await fetchFacebookItems(source.url, limit, metaToken);
          break;
        case "INSTAGRAM":
          if (!metaToken) {
            throw new Error(
              "META_ACCESS_TOKEN absente de l'environnement : la source Instagram ne peut pas être interrogée.",
            );
          }
          if (!instagramUserId) {
            throw new Error(
              "META_IG_USER_ID absente de l'environnement : la source Instagram ne peut pas être interrogée.",
            );
          }
          items = await fetchInstagramItems(
            source.url,
            limit,
            metaToken,
            instagramUserId,
          );
          break;
        default:
          throw new Error(`Type de source non pris en charge : ${source.type}`);
      }

      received += items.length;

      const recent = items.filter((item) => isRecentNewsItem(item.publishedAt));
      const urls = recent.map((item) => item.url);
      const existing = await prisma.newsAlert.findMany({
        where: { sourceId: source.id, url: { in: urls } },
        select: { url: true },
      });
      const known = new Set(existing.map((alert) => alert.url));
      const fresh = recent.filter((item) => !known.has(item.url));

      let titlesFr: string[] | null = null;
      if (!dryRun && fresh.length > 0 && isAiConfigured()) {
        try {
          titlesFr = await translateTitlesToFrench(fresh.map((item) => item.title));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(
            `[veille] ${source.name} : traduction indisponible (${message}). ` +
              "Les titres restent dans leur langue d'origine.",
          );
        }
      }

      if (!dryRun && fresh.length > 0) {
        const result = await prisma.newsAlert.createMany({
          data: fresh.map((item, index) => ({
            sourceId: source.id,
            title: item.title,
            titleFr: titlesFr?.[index] ?? null,
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
          `${items.length - recent.length} trop ancienne(s), ` +
          `${fresh.length} nouvelle(s)${dryRun ? " (dry-run, non enregistrées)" : ""}.`,
      );
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[veille] ÉCHEC ${source.name} : ${message}`);
    }
  };
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      await collectSource(source);
    }
  }));

  console.log(
    `[veille] ${sources.length} source(s), ${received} élément(s) récupéré(s), ` +
      `${created} alerte(s) ${dryRun ? "détectée(s)" : "créée(s)"}.`,
  );

  return { alertsCreated: created, itemsReceived: received, sourcesProcessed: sources.length, sourcesFailed: failures };
}
