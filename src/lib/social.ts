import type { FeedItem } from "./rss";
import { plainText } from "./rss";

/**
 * Collecteurs des réseaux sociaux du News Engine (WP41).
 *
 * Les réseaux ouverts sont interrogés directement via leur API publique :
 * Bluesky, Mastodon et Reddit. YouTube reste géré par le script de collecte
 * (API Data v3). X, Facebook et Instagram disposent de connecteurs dédiés dans
 * social-platforms.ts (API officielles). TikTok et les plateformes sans API
 * accessible passent par un flux RSS de passerelle, traité comme un flux RSS
 * classique.
 */

const USER_AGENT =
  "Mozilla/5.0 (compatible; PromptSport News Engine/1.0; +https://promptsport.fr)";
const MAX_CONTENT_LENGTH = 4000;

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readLimit(limit: number, maximum: number): number {
  return Math.min(Math.max(1, Math.trunc(limit) || 1), maximum);
}

async function readJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error(
      `${label} (${response.status}) : réponse non JSON. Vérifiez l'URL de la source.`,
    );
  }
}

/** Extrait le compte Bluesky d'une URL de profil ou d'un handle. */
export function blueskyActorFromUrl(raw: string): string {
  const value = raw.trim().replace(/^@/, "");
  if (!value) throw new Error("Profil Bluesky vide.");

  if (!value.includes("://")) {
    if (/^(did:[a-z]+:[a-z0-9._:%-]+|[a-z0-9.-]+)$/i.test(value)) return value;
    throw new Error("Profil Bluesky invalide : utilisez https://bsky.app/profile/…");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL Bluesky invalide.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const host = url.hostname.replace(/^www\./i, "");
  if (host !== "bsky.app" || parts[0] !== "profile" || !parts[1]) {
    throw new Error("URL Bluesky invalide : utilisez https://bsky.app/profile/…");
  }
  return decodeURIComponent(parts[1]);
}

type BlueskyFeedResponse = {
  feed?: Array<{
    post?: {
      uri?: string;
      author?: { handle?: string };
      record?: { text?: string; createdAt?: string };
    };
    reason?: unknown;
  }>;
  error?: string;
  message?: string;
};

/** Derniers posts d'un compte Bluesky via l'API publique AT Protocol. */
export async function fetchBlueskyItems(
  sourceUrl: string,
  limit = 10,
): Promise<FeedItem[]> {
  const actor = blueskyActorFromUrl(sourceUrl);
  const endpoint = new URL(
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed",
  );
  endpoint.search = new URLSearchParams({
    actor,
    limit: String(readLimit(limit, 50)),
  }).toString();

  const response = await fetch(endpoint, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await readJson(response, "API Bluesky")) as BlueskyFeedResponse;
  if (!response.ok) {
    throw new Error(
      `API Bluesky (${response.status}) : ${payload.message ?? payload.error ?? "réponse invalide"}`,
    );
  }

  const items: FeedItem[] = [];
  for (const entry of payload.feed ?? []) {
    // Les reposts ne sont pas des publications du compte : on les écarte pour
    // éviter de dupliquer le contenu d'un autre média.
    if (entry.reason) continue;

    const post = entry.post;
    const text = normalizeText(post?.record?.text);
    if (!post?.uri || !post.author?.handle || !text) continue;

    const rkey = post.uri.split("/").pop();
    if (!rkey) continue;

    const publishedAt = post.record?.createdAt
      ? new Date(post.record.createdAt)
      : new Date();

    items.push({
      title: text.slice(0, 300),
      url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
      content: text.slice(0, MAX_CONTENT_LENGTH),
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });
  }

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, readLimit(limit, 50));
}

/** Extrait l'instance et le compte d'une URL de profil Mastodon. */
export function mastodonAccountFromUrl(raw: string): {
  origin: string;
  acct: string;
} {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("URL Mastodon invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL Mastodon invalide.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let username: string | undefined;
  if (parts[0] === "users" && parts[1]) {
    username = decodeURIComponent(parts[1]);
  } else if (parts[0]?.startsWith("@")) {
    username = decodeURIComponent(parts[0].slice(1));
  }

  if (!username) {
    throw new Error(
      "URL Mastodon invalide : utilisez https://instance.social/@compte.",
    );
  }

  return { origin: url.origin, acct: username };
}

type MastodonAccount = { id?: string; url?: string; acct?: string };
type MastodonStatus = {
  url?: string;
  uri?: string;
  content?: string;
  created_at?: string;
};

/** Derniers statuts publics d'un compte Mastodon. */
export async function fetchMastodonItems(
  sourceUrl: string,
  limit = 10,
): Promise<FeedItem[]> {
  const { origin, acct } = mastodonAccountFromUrl(sourceUrl);
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };

  const accountResponse = await fetch(
    `${origin}/api/v1/accounts/lookup?acct=${encodeURIComponent(acct)}`,
    { headers, signal: AbortSignal.timeout(20_000) },
  );
  const account = (await readJson(
    accountResponse,
    "API Mastodon",
  )) as MastodonAccount;
  if (!accountResponse.ok || !account.id) {
    throw new Error(
      `Compte Mastodon introuvable : ${account.acct ?? acct} sur ${origin}.`,
    );
  }

  const statusesUrl = new URL(
    `${origin}/api/v1/accounts/${account.id}/statuses`,
  );
  statusesUrl.search = new URLSearchParams({
    limit: String(readLimit(limit, 40)),
    exclude_replies: "true",
    exclude_reblogs: "true",
  }).toString();

  const statusesResponse = await fetch(statusesUrl, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const statuses = (await readJson(
    statusesResponse,
    "API Mastodon",
  )) as MastodonStatus[];
  if (!statusesResponse.ok || !Array.isArray(statuses)) {
    throw new Error(`Impossible de lire les statuts Mastodon de ${account.acct ?? acct}.`);
  }

  const items: FeedItem[] = [];
  for (const status of statuses) {
    const text = plainText(status.content);
    const url = status.url ?? status.uri;
    if (!text || !url) continue;

    const publishedAt = status.created_at
      ? new Date(status.created_at)
      : new Date();

    items.push({
      title: text.slice(0, 300),
      url,
      content: text.slice(0, MAX_CONTENT_LENGTH),
      publishedAt: Number.isNaN(publishedAt.getTime()) ? new Date() : publishedAt,
    });
  }

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, readLimit(limit, 40));
}

/** Transforme une URL de subreddit/profil Reddit en flux Atom public. */
export function redditFeedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("URL Reddit invalide.");
  }

  const host = url.hostname.replace(/^www\./i, "");
  if (host !== "reddit.com" && !host.endsWith(".reddit.com")) {
    throw new Error("URL Reddit invalide : utilisez https://www.reddit.com/r/….");
  }
  if (url.pathname.endsWith(".rss")) return url.toString();

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/.rss`;
  return url.toString();
}
