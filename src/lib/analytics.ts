import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Analytics maison (WP8d) — first-party, sans dépendance externe, sans PII.
 *
 * Politique de rétention : les événements bruts (`AnalyticsPageView`) sont
 * purgés au-delà de 90 jours par le script d'agrégation ; les agrégats
 * journaliers (`AnalyticsDaily`) sont conservés sans limite. Aucune adresse IP
 * n'est enregistrée : seul un identifiant de cookie anonyme (UUID v4) relie les
 * pages vues d'un même visiteur, et l'agent utilisateur est tronqué.
 */

/** Cookie first-party d'identification anonyme. */
export const VISITOR_COOKIE = "ps_vid";
/** Durée de vie du cookie : 30 jours. */
export const VISITOR_COOKIE_MAX_AGE = 2_592_000;
/** Ancienneté maximale des événements bruts. */
export const RAW_EVENT_RETENTION_DAYS = 90;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Vrai si la valeur est un UUID v4 (donc un identifiant émis par nous). */
export function isValidVisitorId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

/** Lit un cookie dans l'en-tête `Cookie` (sans dépendre de l'API cookies). */
export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Filtrage des robots                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Motifs d'agents utilisateur exclus du tracking : moteurs, crawlers, outils en
 * ligne de commande, navigateurs sans interface et outils de supervision.
 */
const BOT_PATTERNS: RegExp[] = [
  /bot/i,
  /crawler/i,
  /spider/i,
  /googlebot/i,
  /bingbot/i,
  /facebookexternalhit/i,
  /headless/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /python-urllib/i,
  /node-fetch/i,
  /axios/i,
  /go-http-client/i,
  /java\//i,
  /monitoring/i,
  /lighthouse/i,
  /pingdom/i,
  /uptime/i,
  /statuscake/i,
  /semrush/i,
  /ahrefs/i,
  /bytespider/i,
  /gptbot/i,
  /claudebot/i,
  /ccbot/i,
  /applebot/i,
  /duckduckbot/i,
  /yandex/i,
  /baiduspider/i,
  /slurp/i,
  /preview/i,
];

/** Vrai si l'agent utilisateur correspond à un robot connu (ou est absent). */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true;
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

/* -------------------------------------------------------------------------- */
/* Chemins                                                                    */
/* -------------------------------------------------------------------------- */

/** Préfixes jamais trackés (espaces privés, API, assets). */
const IGNORED_PREFIXES = ["/studio", "/backoffice", "/mon-compte", "/api", "/login", "/_next"];

/** Extensions de fichiers statiques. */
const IGNORED_EXTENSIONS = [
  ".ico", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg",
  ".css", ".js", ".mjs", ".map", ".json", ".xml", ".txt", ".woff", ".woff2", ".ttf",
];

/** Normalise un chemin : sans requête, sans fragment, sans double slash. */
export function normalizePath(path: string): string {
  const [pathname] = path.split(/[?#]/);
  const cleaned = `/${pathname.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
  return cleaned.length > 1 ? cleaned.replace(/\/+$/, "") : cleaned;
}

/** Vrai si le chemin est public (utilisé aussi par le composant client). */
export function isPublicPath(path: string): boolean {
  return !IGNORED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Vrai si la page doit être enregistrée (page publique, pas un fichier). */
export function isTrackablePath(path: string): boolean {
  if (!path.startsWith("/") || path.length > 300) return false;
  if (!isPublicPath(path)) return false;
  const lower = path.toLowerCase();
  return !IGNORED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/* -------------------------------------------------------------------------- */
/* Source, appareil, pays                                                     */
/* -------------------------------------------------------------------------- */

export type AnalyticsSource = "direct" | "google" | "facebook" | "x" | "other";

/**
 * Domaine d'origine d'une visite, ou null si le référent est interne ou absent.
 * On ne conserve que le domaine : jamais l'URL complète (aucune donnée
 * personnelle ne peut s'y trouver).
 */
export function parseReferrerHost(referrer: string | null, currentHost: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    const own = (currentHost ?? "").split(":")[0].toLowerCase().replace(/^www\./, "");
    if (!host || host === own) return null;
    return host;
  } catch {
    return null;
  }
}

/** Catégorise la source d'une visite. */
export function categorizeSource(host: string | null): AnalyticsSource {
  if (!host) return "direct";
  if (/(^|\.)google\./.test(host)) return "google";
  if (/(^|\.)(facebook|fb)\./.test(host) || host === "fb.com" || host === "m.facebook.com") {
    return "facebook";
  }
  if (/(^|\.)(twitter|x)\./.test(host) || host === "t.co") return "x";
  return "other";
}

/** Catégorie d'appareil déduite de l'agent utilisateur. */
export function detectDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  if (/ipad|tablet|playbook|silk/i.test(userAgent)) return "tablet";
  if (/mobi|android|iphone|ipod|windows phone/i.test(userAgent)) return "mobile";
  return "desktop";
}

/** Pays fourni par l'hébergeur (en-tête), sinon null — aucune géolocalisation IP. */
export function detectCountry(headers: Headers): string | null {
  const value =
    headers.get("x-vercel-ip-country") ??
    headers.get("cf-ipcountry") ??
    headers.get("x-country-code");
  if (!value) return null;
  const country = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? country : null;
}

/* -------------------------------------------------------------------------- */
/* Enregistrement d'une page vue                                              */
/* -------------------------------------------------------------------------- */

export type PageViewInput = {
  visitorId: string;
  path: string;
  referrer: string | null;
  source: AnalyticsSource;
  userAgent: string | null;
  country: string | null;
  device: string | null;
  userId: string | null;
};

/** Identifiant d'article correspondant à un chemin `/article/<slug>`. */
async function findArticleId(path: string): Promise<string | null> {
  const match = path.match(/^\/article\/([^/]+)$/);
  if (!match) return null;
  const article = await prisma.article.findUnique({
    where: { slug: match[1] },
    select: { id: true },
  });
  return article?.id ?? null;
}

/**
 * Enregistre une page vue : mise à jour du visiteur (création à la première
 * visite), puis insertion de l'événement.
 */
export async function trackPageView(input: PageViewInput): Promise<void> {
  const articleId = await findArticleId(input.path);
  const now = new Date();

  await prisma.analyticsVisitor.upsert({
    where: { visitorId: input.visitorId },
    update: {
      lastSeenAt: now,
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.country ? { country: input.country } : {}),
      ...(input.device ? { device: input.device } : {}),
    },
    create: {
      visitorId: input.visitorId,
      userId: input.userId,
      country: input.country,
      device: input.device,
    },
  });

  await prisma.analyticsPageView.create({
    data: {
      visitorId: input.visitorId,
      path: input.path,
      articleId,
      referrer: input.referrer,
      source: input.source,
      userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
      country: input.country,
      createdAt: now,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Périodes et KPIs                                                           */
/* -------------------------------------------------------------------------- */

/** Minuit UTC du jour d'une date. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Décale une date d'un nombre de jours (en conservant l'heure UTC). */
export function addUtcDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export type AnalyticsKpis = {
  /** Visiteurs uniques depuis minuit UTC. */
  dau: number;
  /** Visiteurs uniques sur 7 jours glissants. */
  wau: number;
  /** Visiteurs uniques sur 30 jours glissants. */
  mau: number;
  /** Visiteurs de la fenêtre de 30 jours déjà connus auparavant. */
  returningVisitors: number;
  /** Taux de retour : récurrents / visiteurs sur 30 jours (en pourcentage). */
  returningRate: number;
  /** Pages vues sur 30 jours. */
  pageViews: number;
};

/**
 * KPIs du tableau de bord.
 *
 * Un visiteur est « récurrent » pour une période si sa première visite
 * (`firstSeenAt`) est antérieure au début de cette période — c'est le KPI
 * fondamental du projet.
 */
export async function getAnalyticsKpis(now = new Date()): Promise<AnalyticsKpis> {
  const startOfToday = startOfUtcDay(now);
  const start7 = addUtcDays(startOfToday, -6);
  const start30 = addUtcDays(startOfToday, -29);

  const [dau, wau, mau, returningVisitors, pageViews] = await Promise.all([
    prisma.analyticsVisitor.count({ where: { pageViews: { some: { createdAt: { gte: startOfToday } } } } }),
    prisma.analyticsVisitor.count({ where: { pageViews: { some: { createdAt: { gte: start7 } } } } }),
    prisma.analyticsVisitor.count({ where: { pageViews: { some: { createdAt: { gte: start30 } } } } }),
    prisma.analyticsVisitor.count({
      where: {
        firstSeenAt: { lt: start30 },
        pageViews: { some: { createdAt: { gte: start30 } } },
      },
    }),
    prisma.analyticsPageView.count({ where: { createdAt: { gte: start30 } } }),
  ]);

  return {
    dau,
    wau,
    mau,
    returningVisitors,
    returningRate: mau > 0 ? Math.round((returningVisitors / mau) * 1000) / 10 : 0,
    pageViews,
  };
}

export type TrafficPoint = { date: Date; visitors: number };

/**
 * Série journalière des visiteurs uniques sur `days` jours.
 *
 * Les jours agrégés viennent d'`AnalyticsDaily` ; aujourd'hui (pas encore agrégé)
 * est compté en direct.
 */
export async function getTrafficSeries(days = 30, now = new Date()): Promise<TrafficPoint[]> {
  const startOfToday = startOfUtcDay(now);
  const start = addUtcDays(startOfToday, -(days - 1));

  const [daily, todayVisitors] = await Promise.all([
    prisma.analyticsDaily.findMany({
      where: { date: { gte: start, lt: startOfToday } },
      orderBy: { date: "asc" },
      select: { date: true, visitors: true },
    }),
    prisma.analyticsVisitor.count({
      where: { pageViews: { some: { createdAt: { gte: startOfToday } } } },
    }),
  ]);

  const byDay = new Map(daily.map((row) => [startOfUtcDay(row.date).toISOString(), row.visitors]));
  const series: TrafficPoint[] = [];
  for (let index = 0; index < days; index += 1) {
    const date = addUtcDays(start, index);
    const key = date.toISOString();
    series.push({
      date,
      visitors: key === startOfToday.toISOString() ? todayVisitors : (byDay.get(key) ?? 0),
    });
  }
  return series;
}

export type TopEntry = { label: string; count: number; href?: string | null };

/** Pages les plus vues depuis `since`. */
export async function getTopPages(since: Date, take = 10): Promise<TopEntry[]> {
  const rows = await prisma.analyticsPageView.groupBy({
    by: ["path"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { path: "desc" } },
    take,
  });
  return rows.map((row) => ({ label: row.path, count: row._count._all, href: row.path }));
}

/** Sources les plus fréquentes depuis `since`. */
export async function getTopSources(since: Date, take = 5): Promise<TopEntry[]> {
  const rows = await prisma.analyticsPageView.groupBy({
    by: ["source"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: { source: "desc" } },
    take,
  });
  return rows.map((row) => ({ label: row.source, count: row._count._all }));
}

/** Articles les plus lus depuis `since`, avec leur titre. */
export async function getTopArticles(since: Date, take = 10): Promise<TopEntry[]> {
  const rows = await prisma.analyticsPageView.groupBy({
    by: ["articleId"],
    where: { createdAt: { gte: since }, articleId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { articleId: "desc" } },
    take,
  });

  const ids = rows.map((row) => row.articleId).filter((id): id is string => Boolean(id));
  const articles = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, slug: true },
  });
  const byId = new Map(articles.map((article) => [article.id, article]));

  return rows.flatMap((row) => {
    const article = row.articleId ? byId.get(row.articleId) : undefined;
    if (!article) return [];
    return [
      {
        label: article.title,
        count: row._count._all,
        href: `/article/${article.slug}`,
      },
    ];
  });
}

/* -------------------------------------------------------------------------- */
/* Agrégation journalière                                                     */
/* -------------------------------------------------------------------------- */

export type DailyAggregate = {
  date: Date;
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  pageViews: number;
  topPages: Array<{ path: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
  topArticles: Array<{ articleId: string; title: string; count: number }>;
};

/** Calcule l'agrégat d'une journée (bornes UTC). */
export async function computeDailyAggregate(day: Date): Promise<DailyAggregate> {
  const start = startOfUtcDay(day);
  const end = addUtcDays(start, 1);
  const window = { gte: start, lt: end };

  const [visitorRows, newVisitors, returningVisitors, pageViews, pages, sources, articles] =
    await Promise.all([
      prisma.analyticsPageView.findMany({
        where: { createdAt: window },
        distinct: ["visitorId"],
        select: { visitorId: true },
      }),
      prisma.analyticsVisitor.count({ where: { firstSeenAt: window } }),
      prisma.analyticsVisitor.count({
        where: { firstSeenAt: { lt: start }, pageViews: { some: { createdAt: window } } },
      }),
      prisma.analyticsPageView.count({ where: { createdAt: window } }),
      prisma.analyticsPageView.groupBy({
        by: ["path"],
        where: { createdAt: window },
        _count: { _all: true },
        orderBy: { _count: { path: "desc" } },
        take: 10,
      }),
      prisma.analyticsPageView.groupBy({
        by: ["source"],
        where: { createdAt: window },
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
        take: 5,
      }),
      prisma.analyticsPageView.groupBy({
        by: ["articleId"],
        where: { createdAt: window, articleId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { articleId: "desc" } },
        take: 10,
      }),
    ]);

  const ids = articles.map((row) => row.articleId).filter((id): id is string => Boolean(id));
  const titles = new Map(
    (
      await prisma.article.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true },
      })
    ).map((article) => [article.id, article.title]),
  );

  return {
    date: start,
    visitors: visitorRows.length,
    newVisitors,
    returningVisitors,
    pageViews,
    topPages: pages.map((row) => ({ path: row.path, count: row._count._all })),
    topSources: sources.map((row) => ({ source: row.source, count: row._count._all })),
    topArticles: articles.flatMap((row) =>
      row.articleId
        ? [{ articleId: row.articleId, title: titles.get(row.articleId) ?? "(article supprimé)", count: row._count._all }]
        : [],
    ),
  };
}

/** Écrit (ou met à jour) l'agrégat d'une journée. */
export async function saveDailyAggregate(aggregate: DailyAggregate): Promise<void> {
  const data = {
    visitors: aggregate.visitors,
    newVisitors: aggregate.newVisitors,
    returningVisitors: aggregate.returningVisitors,
    pageViews: aggregate.pageViews,
    topPages: aggregate.topPages as unknown as Prisma.InputJsonValue,
    topSources: aggregate.topSources as unknown as Prisma.InputJsonValue,
    topArticles: aggregate.topArticles as unknown as Prisma.InputJsonValue,
  };

  await prisma.analyticsDaily.upsert({
    where: { date: aggregate.date },
    update: data,
    create: { date: aggregate.date, ...data },
  });
}

/** Supprime les événements bruts antérieurs à `before` et renvoie leur nombre. */
export async function purgeOldPageViews(before: Date): Promise<number> {
  const { count } = await prisma.analyticsPageView.deleteMany({
    where: { createdAt: { lt: before } },
  });
  return count;
}
