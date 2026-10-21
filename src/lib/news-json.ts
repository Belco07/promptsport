import { plainText, type FeedItem } from "@/lib/rss";

/**
 * Connecteur JSON générique.
 *
 * Certaines instances exposent une API publique sans RSS (CAF, par exemple).
 * Le connecteur accepte les formes courantes : tableau racine, `items`,
 * `data`, `articles`, `results` ou `news`. Il ne devine pas les champs : un
 * article doit fournir un titre et une URL HTTP(S).
 */

const MAX_JSON_BYTES = 5_000_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: JsonRecord, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function findArray(payload: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (depth > 3 || !isRecord(payload)) return null;

  for (const key of ["items", "data", "articles", "results", "news", "posts", "content"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (isRecord(value)) {
      const nested = findArray(value, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return parseDate(numeric);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function readDate(record: JsonRecord): Date | null {
  for (const key of [
    "date",
    "publishedAt",
    "published",
    "publicationDate",
    "datePublished",
    "createdAt",
    "updatedAt",
  ]) {
    const date = parseDate(record[key]);
    if (date) return date;
  }
  return null;
}

function readUrl(record: JsonRecord, baseUrl: string): string | null {
  const raw = readString(record, ["url", "link", "href", "permalink", "path"]);
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Transforme un payload JSON en articles de veille. */
export function parseJsonFeed(
  payload: unknown,
  baseUrl: string,
  limit = 10,
): FeedItem[] {
  const rows = findArray(payload);
  if (!rows) throw new Error("Structure JSON inattendue : aucune liste d'articles.");

  const seen = new Set<string>();
  const items: FeedItem[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const title = plainText(
      readString(row, ["title", "shortTitle", "name", "headline"]) ?? "",
    ).slice(0, 300);
    const url = readUrl(row, baseUrl);
    const publishedAt = readDate(row);
    if (!title || !url || !publishedAt || seen.has(url)) continue;

    const description =
      readString(row, ["description", "excerpt", "summary", "content", "shortDescription"]) ?? "";
    seen.add(url);
    items.push({
      title,
      url,
      content: plainText(description).slice(0, 4000) || null,
      publishedAt,
    });
  }

  return items
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, Math.max(1, limit));
}

/** Récupère une API JSON publique et en extrait les articles. */
export async function fetchJsonItems(apiUrl: string, limit = 10): Promise<FeedItem[]> {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("URL d'API JSON invalide.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Seules les URL HTTP(S) sont acceptées.");
  }

  const response = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; PromptSport News Engine/1.0; +https://promptsport.fr)",
      Accept: "application/json, text/json;q=0.9, */*;q=0.5",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} pour l'API JSON.`);

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new Error(`Réponse JSON trop volumineuse (${declaredLength} octets).`);
  }
  const text = await response.text();
  if (text.length > MAX_JSON_BYTES) {
    throw new Error(`Réponse JSON trop volumineuse (${text.length} caractères).`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Réponse JSON invalide.");
  }
  return parseJsonFeed(payload, response.url || parsed.toString(), limit);
}
