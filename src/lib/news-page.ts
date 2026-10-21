import { plainText } from "@/lib/rss";

/**
 * Utilitaires partagés par les connecteurs de sites officiels.
 *
 * Les sites de clubs et d'instances n'exposent pas tous un flux RSS. On lit
 * donc leurs pages d'actualités avec des règles explicites, sans navigateur
 * headless ni dépendance supplémentaire. Les fonctions de ce module restent
 * volontairement tolérantes : une page peut changer de structure sans faire
 * échouer toute la collecte.
 */

export const NEWS_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0 Safari/537.36 PromptSport-News/1.0";

export type NewsPage = {
  html: string;
  finalUrl: string;
  contentType: string;
};

export type PageMetadata = {
  title: string | null;
  description: string | null;
  publishedAt: Date | null;
};

export type HtmlAnchor = {
  href: string;
  /** Texte complet du lien, utilisé comme secours. */
  text: string;
  /** Titre structuré du lien (h1-h4), plus propre que le texte de carte. */
  heading: string | null;
  /** Date éventuellement présente près du lien dans la page de listing. */
  listingDate: Date | null;
};

const MAX_HTML_BYTES = 8_000_000;

function decodeEntities(value: string): string {
  return value
    .replace(/&#(x?)([0-9a-f]+);/gi, (match, hex: string, code: string) => {
      const point = Number.parseInt(code, hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    })
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function cleanXmlValue(value: string): string {
  return decodeEntities(
    value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
  ).trim();
}

function readDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']/g)) {
    attributes.set(match[1].toLowerCase(), decodeEntities(match[2]));
  }
  return attributes;
}

/** Contenu d'une balise meta, quel que soit l'ordre de ses attributs. */
export function metaContent(html: string, names: readonly string[]): string | null {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    if (!wanted.has(key)) continue;
    const content = attributes.get("content")?.trim();
    if (content) return content;
  }
  return null;
}

export function extractPageMetadata(html: string): PageMetadata {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ??
    plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) ??
    plainText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ??
    null;

  const description =
    metaContent(html, ["og:description", "description", "twitter:description"]) ??
    null;

  const published =
    metaContent(html, [
      "article:published_time",
      "datePublished",
      "og:published_time",
      "article:modified_time",
      "dateModified",
    ]) ??
    html.match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1] ??
    html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ??
    null;

  return {
    title: title ? plainText(title).slice(0, 300) || null : null,
    description: description ? plainText(description).slice(0, 4000) || null : null,
    publishedAt: readDate(published),
  };
}

/** Récupère une page HTML avec un délai et une taille bornés. */
export async function fetchNewsPage(
  url: string,
  timeoutMs = 20_000,
): Promise<NewsPage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL de site officiel invalide.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Seules les URL HTTP(S) sont acceptées.");
  }

  const response = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": NEWS_BROWSER_USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} pour ${parsed.toString()}.`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
    throw new Error(`Page trop volumineuse (${declaredLength} octets).`);
  }

  const html = await response.text();
  if (html.length > MAX_HTML_BYTES) {
    throw new Error(`Page trop volumineuse (${html.length} caractères).`);
  }

  return {
    html,
    finalUrl: response.url || parsed.toString(),
    contentType: response.headers.get("content-type") ?? "",
  };
}

/** Extrait les liens d'une page HTML, avec leur titre et une date éventuelle. */
export function extractAnchors(html: string, baseUrl: string): HtmlAnchor[] {
  const anchors: HtmlAnchor[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = readAttributes(match[1]);
    const rawHref = attributes.get("href");
    if (!rawHref || /^(#|javascript:|mailto:|tel:)/i.test(rawHref)) continue;

    let href: string;
    try {
      href = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(href)) continue;

    const inner = match[2];
    // Une carte contient souvent un sur-titre (souvent <h4>) puis le vrai
    // titre (<h2> ou <h3>). On privilégie donc le titre au sur-titre au lieu
    // de prendre le premier heading rencontré.
    const headings = [...inner.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
      .map((headingMatch) => ({
        level: Number(headingMatch[1]),
        text: plainText(headingMatch[2]),
      }))
      .filter((heading) => heading.text.length > 0);
    const heading =
      [2, 3, 1, 4]
        .flatMap((level) => headings.filter((entry) => entry.level === level))
        .map((entry) => entry.text)[0] ?? "";
    const text = plainText(inner);
    const label = plainText(attributes.get("aria-label") ?? attributes.get("title"));
    const title = heading || text || label;
    if (!title) continue;

    const index = match.index ?? 0;
    const around = html.slice(Math.max(0, index - 1800), Math.min(html.length, index + 1800));
    const timeValue =
      around.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1] ??
      around.match(/datetime=["']([^"']+)["'][^>]*>/i)?.[1] ??
      null;

    anchors.push({
      href,
      text: title.slice(0, 500),
      heading: heading ? heading.slice(0, 300) : null,
      listingDate: readDate(timeValue),
    });
  }

  return anchors;
}

export function sameSiteHost(hostname: string, baseHostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const base = baseHostname.toLowerCase().replace(/^www\./, "");
  if (host === base) return true;
  const parts = base.split(".");
  const apex = parts.slice(-2).join(".");
  return host === apex || host.endsWith(`.${apex}`);
}

export { cleanXmlValue };
