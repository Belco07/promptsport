import { fetchRssItems, type FeedItem } from "@/lib/rss";
import {
  extractAnchors,
  fetchNewsPage,
  sameSiteHost,
} from "@/lib/news-page";

/**
 * Connecteur des sites officiels sans RSS.
 *
 * Chaque site a une règle explicite : page de listing, motif d'URL d'article,
 * section éventuelle, nettoyage du titre et repli de date. Ce choix est
 * volontairement plus strict qu'un scraper générique : on préfère ne rien
 * collecter plutôt que de transformer un lien de navigation en fausse alerte.
 *
 * Le connecteur ne lit que la page de listing. Les sites officiels sont lents
 * et leurs pages d'articles ne sont pas nécessaires pour alerter : le titre et
 * la date du listing suffisent. Les extraits restent donc vides pour ces
 * sources, contrairement aux flux RSS.
 */

export type OfficialSiteRule = {
  /** Motif appliqué au chemin (+ query) de l'URL de l'article. */
  articlePattern: RegExp;
  /** Liens à ignorer malgré le motif. */
  excludePattern?: RegExp;
  /** Le listing est chronologique : une date absente devient « maintenant ». */
  allowUndated?: boolean;
  /** Date lisible dans l'URL (premier groupe de capture). */
  dateFromUrl?: RegExp;
  /** Date lisible dans le texte du lien (LaLiga affiche « SUN 18.10.2026 »). */
  dateFromText?: (text: string) => Date | null;
  /** Titre déduit du slug, quand le listing n'a pas de vrai titre. */
  titleFromUrl?: boolean;
  /** Met le slug en casse de titre (sites anglophones). */
  titleCaseFromUrl?: boolean;
  /** Préfixe de catégorie à retirer du titre. */
  stripPrefix?: RegExp;
  /** Suffixe de marque à retirer du titre. */
  stripSuffix?: RegExp;
  /** Restreint l'analyse à une section précise de la page. */
  scope?: { start: string; end: string };
  /** Nombre maximal de liens examinés. */
  maxCandidates?: number;
  /** Délai propre au site, qui peut être plus lent que la moyenne. */
  timeoutMs?: number;
};

const FUTURE_TOLERANCE_MS = 6 * 60 * 60 * 1000;

const RULES: Record<string, OfficialSiteRule> = {
  "psg.fr": {
    articlePattern: /^\/en\/content\/[^/]+\/?$/,
    maxCandidates: 12,
    timeoutMs: 35_000,
  },
  "om.fr": {
    articlePattern: /^\/fr\/actualites\/[^/]+\/?$/,
    allowUndated: true,
    stripPrefix: /^(?:Équipe 1ère|Club|Supporters|Formation|Academy|Féminines?)\s+/i,
    timeoutMs: 35_000,
  },
  "asmonaco.com": {
    articlePattern: /^\/fr\/news\/[a-z0-9-]+\/?$/,
    excludePattern: /__trashed/i,
    timeoutMs: 35_000,
  },
  "losc.fr": {
    articlePattern: /^\/actualites\/\d{4}-\d{2}-\d{2}\/[^/]+$/,
    dateFromUrl: /\/actualites\/(\d{4}-\d{2}-\d{2})\//,
    timeoutMs: 35_000,
  },
  "rclens.fr": {
    articlePattern: /^\/fr\/(?:news\/)?[a-z0-9-]+-\d{8}\/?$/,
    dateFromUrl: /-(\d{8})\/?$/,
    timeoutMs: 35_000,
  },
  "staderennais.com": {
    articlePattern: /^\/actualites\/[^/]+\/[^/]+\/?$/,
    timeoutMs: 35_000,
  },
  "ogcnice.com": {
    articlePattern: /^\/fr\/article\/\d+\/[^/]+\.html$/,
    allowUndated: true,
    timeoutMs: 60_000,
  },
  "fff.fr": {
    articlePattern: /^\/article\/\d+-/,
    allowUndated: true,
    maxCandidates: 12,
    timeoutMs: 45_000,
  },
  "uefa.com": {
    articlePattern:
      /\/(?:news-media|uefachampionsleague|uefaeuropaleague|uefaconferenceleague|uefasupercup|uefayouthleague|womens-champions-league)\/news\/[^/]+/,
    allowUndated: true,
    maxCandidates: 15,
    timeoutMs: 35_000,
  },
  "en.legaseriea.it": {
    articlePattern: /^\/[^/]+\/news\/[^/]+\/?$/,
    allowUndated: true,
    stripPrefix: /^(?:Lega Calcio\s+)?Serie A\s+/i,
    timeoutMs: 30_000,
  },
  "laliga.com": {
    articlePattern: /^\/en-GB\/news\/[^/]+\/?$/,
    stripPrefix:
      /^.*?(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+\d{2}\.\d{2}\.\d{4}\s*\|\s*(?:[a-z]+\s+)?/i,
    dateFromText: (text) => {
      const match = text.match(
        /\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)\s+(\d{2})\.(\d{2})\.(\d{4})\b/i,
      );
      if (!match) return null;
      const date = new Date(`${match[3]}-${match[2]}-${match[1]}T12:00:00Z`);
      return Number.isNaN(date.getTime()) ? null : date;
    },
    maxCandidates: 12,
    timeoutMs: 30_000,
  },
  "concacaf.com": {
    articlePattern: /^\/competitions\/[^/]+\/news\/[^/]+\/?$/,
    allowUndated: true,
    titleFromUrl: true,
    titleCaseFromUrl: true,
    maxCandidates: 12,
    timeoutMs: 60_000,
  },
  "hac.football": {
    articlePattern: /^\/fr\/posts\/[^/]+\/?$/,
    allowUndated: true,
    timeoutMs: 35_000,
  },
  "angers-sco.fr": {
    articlePattern: /^\/[a-z0-9-]{25,}\/?$/,
    excludePattern:
      /^\/(?:equipe-pro|centre-de-formation|groupes-de-supporters|business|billetterie|club|calendrier|actualites|mentions-legales|politique|conditions|contact|partenaires|boutique|abonnements|stade|musee|fondation|ecole|formations|evenements|cookies|accessibilite|plan-du-site)\b/i,
    allowUndated: true,
    stripPrefix: /^.*?-->\s*/,
    stripSuffix: /\s*(?:-\s*Angers SCO|Lire la suite)\s*$/i,
    timeoutMs: 35_000,
  },
  "fcnantes.com": {
    articlePattern: /^\/articles\/article\d+\.php\?num=\d+$/,
    scope: { start: '<section class="home-curent-news">', end: "</section>" },
    allowUndated: true,
    maxCandidates: 8,
    timeoutMs: 35_000,
  },
};

export type OfficialListingItem = {
  url: string;
  title: string;
  heading: string | null;
  text: string;
  listingDate: Date | null;
  urlDate: Date | null;
  textDate: Date | null;
};

export function officialSiteRule(sourceUrl: string): OfficialSiteRule | null {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return RULES[host] ?? RULES[host.replace(/^www\./, "")] ?? null;
  } catch {
    return null;
  }
}

function parseUrlDate(value: string, pattern: RegExp): Date | null {
  let pathname: string;
  try {
    pathname = new URL(value).pathname;
  } catch {
    return null;
  }
  const raw = pathname.match(pattern)?.[1];
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{8}$/.test(raw)) {
    const date = new Date(
      `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T12:00:00Z`,
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

const TITLE_ACRONYMS = new Set([
  "ac",
  "afc",
  "caf",
  "cd",
  "cf",
  "concacaf",
  "conmebol",
  "fc",
  "fifa",
  "ofc",
  "om",
  "psg",
  "sc",
  "sf",
  "uefa",
  "var",
]);
const TITLE_SMALL_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "but",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "over",
  "the",
  "to",
  "vs",
  "with",
]);

function titleCaseSlug(value: string): string {
  const words = value.split(" ");
  return words
    .map((word, index) => {
      const lower = word.toLocaleLowerCase("en");
      if (TITLE_ACRONYMS.has(lower)) return lower.toUpperCase();
      if (index > 0 && index < words.length - 1 && TITLE_SMALL_WORDS.has(lower)) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * Transforme un slug d'article en titre lisible, sans accents inventés.
 * Le mode `titleCase` est réservé aux sites anglophones : les titres français
 * restent en casse de phrase.
 */
export function titleFromArticleUrl(
  rawUrl: string,
  options: { titleCase?: boolean } = {},
): string | null {
  try {
    const path = new URL(rawUrl).pathname;
    const segment = path.split("/").filter(Boolean).pop();
    if (!segment) return null;
    let slug = decodeURIComponent(segment).replace(/\.(?:html?|php|aspx?)$/i, "");
    slug = slug.replace(/^[a-z0-9]+_article_\d+-/i, "").replace(/^\d+-/, "");
    slug = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    if (!slug) return null;
    if (options.titleCase) return titleCaseSlug(slug);
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  } catch {
    return null;
  }
}

/** Titre affiché pour une entrée de listing, après nettoyage éventuel. */
export function officialItemTitle(
  item: OfficialListingItem,
  rule: OfficialSiteRule,
): string | null {
  if (rule.titleFromUrl) {
    const fromUrl = titleFromArticleUrl(item.url, {
      titleCase: rule.titleCaseFromUrl,
    });
    if (fromUrl) return fromUrl.slice(0, 300);
  }

  let title = (item.heading || item.text).trim();
  if (rule.stripPrefix) title = title.replace(rule.stripPrefix, "").trim();
  if (rule.stripSuffix) title = title.replace(rule.stripSuffix, "").trim();
  title = title.replace(/\s+/g, " ").trim();

  if (title.length >= 5) return title.slice(0, 300);
  if (item.heading && item.heading.length >= 5) return item.heading.slice(0, 300);
  if (item.text.length >= 5) return item.text.slice(0, 300);
  return null;
}

/** Analyse une page de listing selon la règle du site. */
export function parseOfficialListing(
  html: string,
  baseUrl: string,
  rule: OfficialSiteRule,
  limit = 10,
): OfficialListingItem[] {
  let source = html;
  if (rule.scope) {
    const start = html.indexOf(rule.scope.start);
    if (start < 0) return [];
    const end = html.indexOf(rule.scope.end, start + rule.scope.start.length);
    source = html.slice(start, end < 0 ? html.length : end + rule.scope.end.length);
  }

  const base = new URL(baseUrl);
  const items = new Map<string, OfficialListingItem>();
  const maxCandidates = Math.min(
    rule.maxCandidates ?? Math.max(limit * 3, 8),
    24,
  );

  for (const anchor of extractAnchors(source, baseUrl)) {
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      continue;
    }
    if (!sameSiteHost(url.hostname, base.hostname)) continue;
    const pathAndQuery = `${url.pathname}${url.search}`;
    if (!rule.articlePattern.test(pathAndQuery)) continue;
    if (rule.excludePattern?.test(pathAndQuery)) continue;

    const title = (anchor.heading || anchor.text).trim();
    if (title.length < 5) continue;

    const key = url.toString();
    const candidate: OfficialListingItem = {
      url: key,
      title: title.slice(0, 300),
      heading: anchor.heading ? anchor.heading.slice(0, 300) : null,
      text: anchor.text.slice(0, 500),
      listingDate: anchor.listingDate,
      urlDate: rule.dateFromUrl ? parseUrlDate(key, rule.dateFromUrl) : null,
      textDate: rule.dateFromText ? rule.dateFromText(anchor.text) : null,
    };

    const existing = items.get(key);
    if (!existing) {
      items.set(key, candidate);
    } else {
      // Un même article peut avoir plusieurs liens : « image », « en savoir
      // plus », puis carte complète avec la date. On fusionne les meilleures
      // informations au lieu de garder le premier lien rencontré.
      const useCandidateText = candidate.text.length >= existing.text.length;
      items.set(key, {
        url: key,
        title: useCandidateText ? candidate.title : existing.title,
        heading: candidate.heading ?? existing.heading,
        text: useCandidateText ? candidate.text : existing.text,
        listingDate: candidate.listingDate ?? existing.listingDate,
        urlDate: candidate.urlDate ?? existing.urlDate,
        textDate: candidate.textDate ?? existing.textDate,
      });
    }
    if (items.size >= maxCandidates) break;
  }

  return [...items.values()];
}

/**
 * Récupère les articles d'un site officiel à partir de sa page de listing.
 * Aucune page d'article n'est ouverte : le titre et la date du listing sont
 * suffisants pour la veille, et cela évite de bloquer le cron sur les sites
 * les plus lents.
 */
export async function fetchOfficialSiteItems(
  sourceUrl: string,
  limit = 10,
): Promise<FeedItem[]> {
  const rule = officialSiteRule(sourceUrl);
  if (!rule) {
    throw new Error(
      "Aucune règle de lecture n'est configurée pour ce site officiel. " +
        "Ajoutez le domaine dans src/lib/official-sites.ts.",
    );
  }

  const page = await fetchNewsPage(sourceUrl, rule.timeoutMs ?? 35_000);
  if (
    /\b(?:rss|atom)\b/i.test(page.contentType) ||
    /^\s*(?:<\?xml[\s\S]*?)?<rss\b|^\s*(?:<\?xml[\s\S]*?)?<feed\b/i.test(page.html)
  ) {
    return fetchRssItems(page.finalUrl, limit);
  }

  const candidates = parseOfficialListing(page.html, page.finalUrl, rule, limit);
  if (candidates.length === 0) {
    throw new Error(
      `Aucun article reconnu sur ${page.finalUrl}. ` +
        "La structure du site a peut-être changé.",
    );
  }

  const maxItems = Math.max(1, limit);
  const items: FeedItem[] = [];
  for (const item of candidates) {
    const title = officialItemTitle(item, rule);
    const publishedAt =
      item.listingDate ??
      item.urlDate ??
      item.textDate ??
      (rule.allowUndated ? new Date() : null);
    if (!title || !publishedAt) continue;
    // Contenu programmé : on attend sa date de publication réelle.
    if (publishedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) continue;

    items.push({
      title,
      url: item.url,
      content: null,
      publishedAt,
    });
    if (items.length >= maxItems) break;
  }

  if (items.length === 0) {
    throw new Error(
      `Aucun article daté reconnu sur ${page.finalUrl}. ` +
        "Vérifiez la règle de date du site.",
    );
  }

  return items.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
