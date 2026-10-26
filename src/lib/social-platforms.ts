import type { FeedItem } from "./rss";

/**
 * Connecteurs X, Facebook et Instagram du News Engine (WP41).
 *
 * Ces trois plateformes n'exposent pas de timeline publique sans
 * authentification. On utilise donc leurs API officielles :
 *   - X API v2 (Bearer Token applicatif) ;
 *   - Meta Graph API (token utilisateur/page) pour Facebook ;
 *   - Meta Graph API + business discovery pour Instagram.
 *
 * Aucun scraping ni contournement d'accès n'est effectué ici. Les tokens sont
 * lus dans l'environnement par le script de collecte, jamais exposés au client.
 */

const USER_AGENT =
  "Mozilla/5.0 (compatible; PromptSport News Engine/1.0; +https://promptsport.fr)";
const DEFAULT_GRAPH_VERSION = "v23.0";
const MAX_CONTENT_LENGTH = 4000;

function readLimit(limit: number, maximum: number): number {
  return Math.min(Math.max(1, Math.trunc(limit) || 1), maximum);
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text || undefined;
}

async function readJson(response: Response, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new Error(`${label} (${response.status}) : réponse illisible.`);
  }
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `${label} (${response.status}) : réponse non JSON. Vérifiez l'accès à l'API.`,
    );
  }
}

/** Extrait un message lisible d'une erreur X ou Meta Graph API. */
function apiErrorMessage(payload: unknown, fallback: string): string {
  const record = asRecord(payload);
  if (!record) return fallback;

  const error = asRecord(record.error);
  const errorMessage = asString(error?.message);
  if (errorMessage) return errorMessage;

  if (Array.isArray(record.errors) && record.errors.length > 0) {
    const first = asRecord(record.errors[0]);
    const message = asString(first?.message);
    if (message) return message;
  }

  return (
    asString(record.detail) ??
    asString(record.title) ??
    asString(record.message) ??
    fallback
  );
}

function parseDate(value: string | undefined): Date {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function sortAndSlice(items: FeedItem[], limit: number): FeedItem[] {
  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, limit);
}

const X_RESERVED_PATHS = new Set([
  "compose",
  "explore",
  "home",
  "i",
  "login",
  "messages",
  "notifications",
  "privacy",
  "search",
  "settings",
  "share",
  "signup",
  "tos",
]);

/** Extrait le handle X d'une URL de profil (ou d'un handle brut). */
export function xHandleFromUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Profil X vide.");

  let handle: string | undefined;
  if (!value.includes("://")) {
    handle = value.replace(/^@/, "");
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("URL X invalide.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("URL X invalide : seules les adresses HTTP(S) sont acceptées.");
    }

    const host = url.hostname.replace(/^www\./i, "");
    if (host !== "x.com" && host !== "twitter.com") {
      throw new Error("URL X invalide : utilisez https://x.com/… ou https://twitter.com/….");
    }

    handle = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "");
  }

  if (
    !handle ||
    X_RESERVED_PATHS.has(handle.toLowerCase()) ||
    !/^[A-Za-z0-9_]{1,15}$/.test(handle)
  ) {
    throw new Error("URL X invalide : indiquez l'URL d'un profil, par exemple https://x.com/ESPN.");
  }
  return handle;
}

const FACEBOOK_RESERVED_PATHS = new Set([
  "ads",
  "bookmarks",
  "business",
  "events",
  "friends",
  "fundraisers",
  "games",
  "gaming",
  "groups",
  "help",
  "login",
  "marketplace",
  "memories",
  "messages",
  "notifications",
  "permalink.php",
  "photo",
  "photos",
  "policies",
  "privacy",
  "profile.php",
  "reels",
  "saved",
  "settings",
  "share.php",
  "sharer.php",
  "stories",
  "story.php",
  "terms",
  "video",
  "videos",
  "watch",
]);

/** Extrait l'identifiant ou le nom de page Facebook d'une URL. */
export function facebookPageFromUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Page Facebook vide.");

  if (!value.includes("://")) {
    if (/^\d+$/.test(value) || /^[A-Za-z0-9.-]{2,}$/.test(value)) return value;
    throw new Error("Page Facebook invalide.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL Facebook invalide.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL Facebook invalide : seules les adresses HTTP(S) sont acceptées.");
  }

  const host = url.hostname.replace(/^www\./i, "");
  if (host !== "facebook.com" && host !== "fb.com" && !host.endsWith(".facebook.com")) {
    throw new Error("URL Facebook invalide : utilisez https://www.facebook.com/….");
  }

  const id = url.searchParams.get("id");
  if (id?.trim()) return id.trim();

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("URL Facebook invalide : précisez le nom ou l'identifiant de la page.");
  }

  if (parts[0] === "pages" || parts[0] === "people") {
    const last = parts[parts.length - 1];
    if (last) return decodeURIComponent(last);
    throw new Error("URL Facebook invalide : identifiant de page manquant.");
  }

  if (FACEBOOK_RESERVED_PATHS.has(parts[0].toLowerCase())) {
    throw new Error(
      "URL Facebook invalide : utilisez l'URL d'une page, pas celle d'un groupe ou d'un contenu.",
    );
  }

  return decodeURIComponent(parts[0]);
}

const INSTAGRAM_RESERVED_PATHS = new Set([
  "about",
  "accounts",
  "activity",
  "api",
  "challenge",
  "developer",
  "developers",
  "direct",
  "directory",
  "download",
  "emails",
  "explore",
  "graphql",
  "help",
  "invites",
  "legal",
  "locations",
  "nametag",
  "oauth",
  "p",
  "press",
  "privacy",
  "reel",
  "reels",
  "session",
  "static",
  "stories",
  "terms",
  "topics",
  "tv",
  "your_activity",
]);

/** Extrait le nom de compte Instagram d'une URL de profil (ou d'un handle). */
export function instagramUsernameFromUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Profil Instagram vide.");

  let username: string | undefined;
  if (!value.includes("://")) {
    username = value.replace(/^@/, "");
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("URL Instagram invalide.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("URL Instagram invalide : seules les adresses HTTP(S) sont acceptées.");
    }

    const host = url.hostname.replace(/^www\./i, "");
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) {
      throw new Error("URL Instagram invalide : utilisez https://www.instagram.com/….");
    }

    username = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "");
  }

  if (
    !username ||
    INSTAGRAM_RESERVED_PATHS.has(username.toLowerCase()) ||
    !/^[A-Za-z0-9._]{1,30}$/.test(username)
  ) {
    throw new Error(
      "URL Instagram invalide : indiquez l'URL d'un profil, par exemple https://www.instagram.com/espn.",
    );
  }
  return username;
}

/** Derniers posts d'un compte X via X API v2 (Bearer Token). */
export async function fetchXItems(
  sourceUrl: string,
  limit = 10,
  bearerToken: string,
): Promise<FeedItem[]> {
  const token = bearerToken.trim();
  if (!token) {
    throw new Error("X_BEARER_TOKEN absente : configurez le Bearer Token de l'API X.");
  }

  const handle = xHandleFromUrl(sourceUrl);
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    Accept: "application/json",
  };

  const userEndpoint = new URL(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`,
  );
  userEndpoint.search = new URLSearchParams({ "user.fields": "id,username" }).toString();

  const userResponse = await fetch(userEndpoint, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const userPayload = await readJson(userResponse, "API X");
  if (!userResponse.ok) {
    throw new Error(
      `API X (${userResponse.status}) : ${apiErrorMessage(userPayload, "requête refusée")}`,
    );
  }

  const user = asRecord(asRecord(userPayload)?.data);
  const userId = asString(user?.id);
  if (!userId) {
    const detail = apiErrorMessage(userPayload, "");
    throw new Error(
      `Compte X introuvable : @${handle}${detail ? ` (${detail})` : ""}.`,
    );
  }
  const username = asString(user?.username) ?? handle;

  const maxResults = Math.max(5, readLimit(limit, 100));
  const tweetsEndpoint = new URL(
    `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets`,
  );
  tweetsEndpoint.search = new URLSearchParams({
    max_results: String(maxResults),
    exclude: "retweets,replies",
    "tweet.fields": "created_at,text",
  }).toString();

  const tweetsResponse = await fetch(tweetsEndpoint, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const tweetsPayload = await readJson(tweetsResponse, "API X");
  if (!tweetsResponse.ok) {
    throw new Error(
      `API X (${tweetsResponse.status}) : ${apiErrorMessage(tweetsPayload, "requête refusée")}`,
    );
  }

  const tweets = asRecord(tweetsPayload)?.data;
  if (!Array.isArray(tweets)) return [];

  const items: FeedItem[] = [];
  for (const raw of tweets) {
    const tweet = asRecord(raw);
    const text = normalizeText(asString(tweet?.text));
    const id = asString(tweet?.id);
    if (!text || !id) continue;

    items.push({
      title: text.slice(0, 300),
      url: `https://x.com/${encodeURIComponent(username)}/status/${encodeURIComponent(id)}`,
      content: text.slice(0, MAX_CONTENT_LENGTH),
      publishedAt: parseDate(asString(tweet?.created_at)),
    });
  }

  return sortAndSlice(items, readLimit(limit, 100));
}

function graphVersion(): string {
  const raw = process.env.META_GRAPH_VERSION?.trim();
  if (!raw) return DEFAULT_GRAPH_VERSION;
  if (/^v\d+\.\d+$/.test(raw)) return raw;
  if (/^\d+\.\d+$/.test(raw)) return `v${raw}`;
  return DEFAULT_GRAPH_VERSION;
}

async function graphGet(
  path: string,
  params: Record<string, string>,
  accessToken: string,
  label: string,
): Promise<unknown> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  url.search = new URLSearchParams(params).toString();

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await readJson(response, label);
  if (!response.ok || asRecord(payload)?.error) {
    throw new Error(
      `${label} (${response.status}) : ${apiErrorMessage(payload, "requête refusée")}`,
    );
  }
  return payload;
}

/** Derniers posts publics d'une page Facebook via Meta Graph API. */
export async function fetchFacebookItems(
  sourceUrl: string,
  limit = 10,
  accessToken: string,
): Promise<FeedItem[]> {
  const token = accessToken.trim();
  if (!token) {
    throw new Error(
      "META_ACCESS_TOKEN absente : configurez un token d'accès Meta Graph API.",
    );
  }

  const pageIdentifier = facebookPageFromUrl(sourceUrl);
  const pagePayload = await graphGet(
    encodeURIComponent(pageIdentifier),
    { fields: "id,name,username" },
    token,
    "API Facebook",
  );
  const pageRecord = asRecord(pagePayload);
  const page = asRecord(pageRecord?.data) ?? pageRecord;
  const pageId = asString(page?.id) ?? pageIdentifier;
  const count = readLimit(limit, 100);

  const postsPayload = await graphGet(
    `${encodeURIComponent(pageId)}/posts`,
    {
      fields: "id,message,created_time,permalink_url,full_picture",
      limit: String(count),
    },
    token,
    "API Facebook",
  );
  const posts = asRecord(postsPayload)?.data;
  if (!Array.isArray(posts)) return [];

  const items: FeedItem[] = [];
  for (const raw of posts) {
    const post = asRecord(raw);
    const message = normalizeText(asString(post?.message));
    const id = asString(post?.id);
    const url =
      asString(post?.permalink_url) ??
      (id ? `https://www.facebook.com/${id}` : null);
    if (!message || !url) continue;

    items.push({
      title: message.slice(0, 300),
      url,
      content: message.slice(0, MAX_CONTENT_LENGTH),
      publishedAt: parseDate(asString(post?.created_time)),
      imageUrl: asString(post?.full_picture) ?? null,
    });
  }

  return sortAndSlice(items, count);
}

/** Derniers médias d'un compte Instagram public Business/Creator. */
export async function fetchInstagramItems(
  sourceUrl: string,
  limit = 10,
  accessToken: string,
  igUserId: string,
): Promise<FeedItem[]> {
  const token = accessToken.trim();
  const userId = igUserId.trim();
  if (!token) {
    throw new Error(
      "META_ACCESS_TOKEN absente : configurez un token d'accès Meta Graph API.",
    );
  }
  if (!userId) {
    throw new Error(
      "META_IG_USER_ID absente : configurez l'identifiant du compte Instagram Business/Creator authentifié.",
    );
  }

  const target = instagramUsernameFromUrl(sourceUrl);
  const count = readLimit(limit, 50);

  const mePayload = await graphGet(
    encodeURIComponent(userId),
    { fields: "id,username" },
    token,
    "API Instagram",
  );
  const meRecord = asRecord(mePayload);
  const me = asRecord(meRecord?.data) ?? meRecord;
  const meUsername = asString(me?.username);

  const mediaFields =
    "id,caption,permalink,media_type,media_url,thumbnail_url,timestamp";
  let mediaData: unknown;

  if (meUsername?.toLowerCase() === target.toLowerCase()) {
    const ownPayload = await graphGet(
      `${encodeURIComponent(userId)}/media`,
      { fields: mediaFields, limit: String(count) },
      token,
      "API Instagram",
    );
    mediaData = asRecord(ownPayload)?.data;
  } else {
    const fields =
      `business_discovery.username(${target})` +
      `{id,username,media.limit(${count}){${mediaFields}}}`;
    const discoveryPayload = await graphGet(
      encodeURIComponent(userId),
      { fields },
      token,
      "API Instagram",
    );
    const discovery = asRecord(asRecord(discoveryPayload)?.business_discovery);
    if (!discovery) {
      throw new Error(
        `Compte Instagram inaccessible : @${target}. Le compte doit être public et de type Business/Creator.`,
      );
    }
    mediaData = asRecord(discovery.media)?.data;
  }

  if (!Array.isArray(mediaData)) return [];

  const items: FeedItem[] = [];
  for (const raw of mediaData) {
    const media = asRecord(raw);
    const caption = normalizeText(asString(media?.caption));
    const url = asString(media?.permalink);
    if (!caption || !url) continue;

    items.push({
      title: caption.slice(0, 300),
      url,
      content: caption.slice(0, MAX_CONTENT_LENGTH),
      publishedAt: parseDate(asString(media?.timestamp)),
      imageUrl:
        asString(media?.media_url) ??
        asString(media?.thumbnail_url) ??
        null,
    });
  }

  return sortAndSlice(items, count);
}

const GRAPH_WRITE_TIMEOUT_MS = 30_000;
const INSTAGRAM_STATUS_ATTEMPTS = 8;
const INSTAGRAM_STATUS_DELAY_MS = 1_500;

function facebookPublishingCredentials(): { token: string; pageId: string } {
  const token = process.env.META_FACEBOOK_TOKEN?.trim();
  const pageId = process.env.META_FACEBOOK_PAGE_ID?.trim();
  if (!token || !pageId) {
    throw new Error(
      "Publication Facebook non configurée : META_FACEBOOK_TOKEN et META_FACEBOOK_PAGE_ID sont requis.",
    );
  }
  return { token, pageId };
}

function instagramPublishingCredentials(): { token: string; userId: string } {
  const token = process.env.META_ACCESS_TOKEN?.trim();
  const userId = process.env.META_IG_USER_ID?.trim();
  if (!token || !userId) {
    throw new Error(
      "Publication Instagram non configurée : META_ACCESS_TOKEN et META_IG_USER_ID sont requis.",
    );
  }
  return { token, userId };
}

/** La Page Facebook est-elle configurée pour publier via l'API ? */
export function facebookPublishingConfigured(): boolean {
  return Boolean(
    process.env.META_FACEBOOK_TOKEN?.trim() &&
      process.env.META_FACEBOOK_PAGE_ID?.trim(),
  );
}

/** Le compte Instagram est-il configuré pour publier via l'API ? */
export function instagramPublishingConfigured(): boolean {
  return Boolean(
    process.env.META_ACCESS_TOKEN?.trim() &&
      process.env.META_IG_USER_ID?.trim(),
  );
}

async function graphPost(
  path: string,
  params: Record<string, string>,
  accessToken: string,
  label: string,
): Promise<unknown> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: accessToken });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(GRAPH_WRITE_TIMEOUT_MS),
  });
  const payload = await readJson(response, label);
  if (!response.ok || asRecord(payload)?.error) {
    throw new Error(
      `${label} (${response.status}) : ${apiErrorMessage(payload, "requête refusée")}`,
    );
  }
  return payload;
}

function graphRecord(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  return asRecord(record?.data) ?? record;
}

/** Publie un message sur la Page Facebook configurée. */
export async function publishFacebookPost(
  content: string,
): Promise<{ id: string }> {
  const message = content.trim();
  if (!message) throw new Error("Le texte du post Facebook est vide.");

  const { token, pageId } = facebookPublishingCredentials();
  const payload = await graphPost(
    `${encodeURIComponent(pageId)}/feed`,
    { message },
    token,
    "Publication Facebook",
  );
  const id = asString(graphRecord(payload)?.id);
  if (!id) throw new Error("Publication Facebook : identifiant du post absent.");
  return { id };
}

/** Attend que Meta ait fini de traiter l'image du conteneur Instagram. */
async function waitForInstagramContainer(
  creationId: string,
  token: string,
): Promise<void> {
  for (let attempt = 0; attempt < INSTAGRAM_STATUS_ATTEMPTS; attempt += 1) {
    const payload = await graphGet(
      encodeURIComponent(creationId),
      { fields: "status_code" },
      token,
      "Publication Instagram",
    );
    const status = asString(graphRecord(payload)?.status_code);
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new Error(`Publication Instagram : traitement de l'image en échec (${status}).`);
    }
    if (attempt < INSTAGRAM_STATUS_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, INSTAGRAM_STATUS_DELAY_MS));
    }
  }
  throw new Error("Publication Instagram : l'image n'est pas encore prête. Réessayez dans quelques minutes.");
}

/**
 * Publie une image avec légende sur le compte Instagram Business/Creator
 * configuré. Meta impose deux appels : création du conteneur puis publication.
 */
export async function publishInstagramPost(
  content: string,
  imageUrl: string,
): Promise<{ id: string }> {
  const caption = content.trim().slice(0, 2_200);
  if (!caption) throw new Error("La légende du post Instagram est vide.");

  let image: URL;
  try {
    image = new URL(imageUrl.trim());
  } catch {
    throw new Error("Publication Instagram : l'URL de l'image est invalide.");
  }
  if (image.protocol !== "https:") {
    throw new Error(
      "Publication Instagram : l'image doit être servie en HTTPS public (vérifiez NEXT_PUBLIC_SITE_URL).",
    );
  }

  const { token, userId } = instagramPublishingCredentials();
  const containerPayload = await graphPost(
    `${encodeURIComponent(userId)}/media`,
    { image_url: image.toString(), caption },
    token,
    "Publication Instagram",
  );
  const creationId = asString(graphRecord(containerPayload)?.id);
  if (!creationId) {
    throw new Error("Publication Instagram : conteneur média non créé.");
  }

  await waitForInstagramContainer(creationId, token);

  const publishedPayload = await graphPost(
    `${encodeURIComponent(userId)}/media_publish`,
    { creation_id: creationId },
    token,
    "Publication Instagram",
  );
  const id = asString(graphRecord(publishedPayload)?.id);
  if (!id) throw new Error("Publication Instagram : identifiant du média absent.");
  return { id };
}
