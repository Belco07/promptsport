import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import type { Prisma } from "@/generated/prisma/client";
import type { StandingRow } from "@/lib/standings";

/**
 * Synchronisation AllSportsApi (WP19a-bis, Phase 2).
 *
 * Remplace API-Football pour l'import des compétitions : l'offre gratuite
 * d'API-Football ne couvre que les saisons 2022-2024, alors qu'AllSportsApi
 * donne accès à la saison en cours et aux scores en direct (validation Phase 1 :
 * 15/15, voir `scripts/test-allsports.cjs`).
 *
 * `src/lib/api-football-sync.ts` reste en place comme service de repli : ce
 * fichier est autonome et ne le modifie pas. Le cache, le registre de quota
 * (100 requêtes/24 h) et la transaction d'écriture reprennent la même
 * architecture, avec les identifiants et les formes de réponse propres à
 * AllSportsApi.
 *
 * Particularités relevées lors de la validation :
 *   - l'accès passe par **RapidAPI** (`allsportsapi2.p.rapidapi.com`) avec les
 *     en-têtes `x-rapidapi-key` / `x-rapidapi-host` ; les hôtes
 *     `allsportsapi.com` et `apiv2.allsportsapi.com` rejettent cette clé ;
 *   - les réponses encapsulent leurs tableaux dans des clés nommées
 *     (`seasons`, `teams`, `events`) et non dans `result` ;
 *   - les équipes n'exposent **aucune URL de logo** (les images passent par
 *     `/api/team/{id}/image`, derrière l'authentification de l'API) : `logoUrl`
 *     reste donc `null` et l'interface affiche son visuel de repli.
 */

/** Compétitions importables : identifiants de tournoi AllSportsApi. */
export const LEAGUES = {
  FL1: { id: 34, name: "Ligue 1", slug: "ligue-1", country: "France" },
  PL: { id: 17, name: "Premier League", slug: "premier-league", country: "Angleterre" },
  PD: { id: 8, name: "LaLiga", slug: "liga", country: "Espagne" },
  SA: { id: 23, name: "Serie A", slug: "serie-a", country: "Italie" },
  BL1: { id: 35, name: "Bundesliga", slug: "bundesliga", country: "Allemagne" },
  CL: { id: 7, name: "UEFA Champions League", slug: "uefa-champions-league", country: "Europe" },
  EL: { id: 679, name: "UEFA Europa League", slug: "uefa-europa-league", country: "Europe" },
  ECL: { id: 17015, name: "UEFA Conference League", slug: "uefa-conference-league", country: "Europe" },
} as const;

export const DEFAULT_COMPETITIONS = ["FL1", "PL", "PD", "SA", "BL1", "CL", "EL", "ECL"];

const operationBudget = new AsyncLocalStorage<{ remaining: number; reserved: number }>();
/** Shared across parallel preparation calls, including retries. */
export async function withSportsRequestBudget<T>(maximum: number, work: () => Promise<T>) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 80) throw new Error("Budget requis : de 1 à 80 requêtes.");
  const budget = { remaining: maximum, reserved: 0 };
  return operationBudget.run(budget, async () => ({ result: await work(), reservedRequests: budget.reserved }));
}

export class AllSportsHttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export const COMPETITION_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(LEAGUES).map(([code, league]) => [code, league.name]),
);

export type CompetitionSyncDetail = { code: string; name: string; season: string; teams: number; matches: number };
export type FootballSyncSummary = {
  competitions: number;
  teams: number;
  matches: number;
  results: CompetitionSyncDetail[];
  errors: string[];
};

/** Formes des réponses AllSportsApi (champs utilisés uniquement). */
export type ApiSeason = { id: number; year: string; name?: string };
export type ApiTeam = {
  id: number;
  name: string;
  shortName?: string | null;
  nameCode?: string | null;
  category?: { name?: string | null; country?: { name?: string | null } | null } | null;
  country?: { name?: string | null } | null;
};
export type ApiEventStatus = { code?: number; description?: string | null; type?: string | null };
export type ApiEvent = {
  id: number;
  startTimestamp: number;
  status: ApiEventStatus;
  venue?: { name?: string | null; stadium?: { name?: string | null } | null } | null;
  homeTeam: ApiTeam;
  awayTeam: ApiTeam;
  homeScore?: { current?: number | null } | null;
  awayScore?: { current?: number | null } | null;
  tournament?: { name?: string | null } | null;
  season?: { id?: number; year?: string | null } | null;
  lastPeriod?: string;
  time?: { currentPeriodStartTimestamp?: number; max?: number };
};

export type MatchClock = { minute: string | null; observedAt: string; running: boolean; periodEnd: number | null };
export function eventClock(event: ApiEvent, now = Date.now()): MatchClock {
  const observedAt = new Date(now).toISOString();
  const description = event.status.description?.toLowerCase() ?? "";
  if (event.status.code === 31 || /halftime|half time|break|awaiting/.test(description)) return { minute: "MT", observedAt, running: false, periodEnd: null };
  if (/penalt/.test(description)) return { minute: "TAB", observedAt, running: false, periodEnd: null };
  const start = event.time?.currentPeriodStartTimestamp;
  const period = event.lastPeriod ?? (event.status.code === 6 || /1st half/.test(description) ? "period1" : event.status.code === 7 || /2nd half/.test(description) ? "period2" : "");
  const bases:Record<string,number>={period1:0,period2:45,period3:90,period4:105};
  if (event.status.type !== "inprogress" || !Number.isSafeInteger(start) || !period || bases[period] === undefined) return {minute:null,observedAt,running:false,periodEnd:null};
  const elapsed=Math.max(0,Math.floor((now/1000-start!)/60));
  const duration=event.time?.max ? Math.floor(event.time.max/60) : bases[period]>=90?15:45;
  const end=bases[period]+duration;
  return {minute:elapsed>duration?`${end}+${elapsed-duration}′`:`${bases[period]+elapsed}′`,observedAt,running:true,periodEnd:end};
}

export async function withStoredMatchClocks<T extends {id:string;minute?:string|null;minuteObservedAt?:string|null}>(matches:T[]) {
  if (!matches.length) return [] as (T & {minute:string|null;minuteObservedAt:string|null;minutePeriodEnd:number|null})[];
  const logs=await prisma.syncLog.findMany({where:{type:{in:matches.map(match=>`clock:${match.id}`)},status:"SUCCESS"},orderBy:{finishedAt:"desc"},distinct:["type"],select:{type:true,errors:true}});
  return matches.map(match=>{const clock=logs.find(log=>log.type===`clock:${match.id}`)?.errors as unknown as MatchClock|undefined;return {...match,minute:clock?.minute??match.minute??null,minuteObservedAt:clock?.observedAt??match.minuteObservedAt??null,minutePeriodEnd:clock?.periodEnd??null};});
}
export type PreparedCompetition = {
  code: keyof typeof LEAGUES;
  season: ApiSeason;
  teams: ApiTeam[];
  events: ApiEvent[];
  completeHistory?: boolean;
};

const HOST = "allsportsapi2.p.rapidapi.com";
const BASE = `https://${HOST}`;
const DAY = 86400000;
/** 5 requêtes/seconde (plan Basic) : 300 ms entre deux appels, marge incluse. */
const MIN_INTERVAL_MS = 300;
/** Tentatives par requête : l'API a montré des réponses vides/expirées ponctuelles. */
const MAX_ATTEMPTS = 3;
/** Pages de matchs récupérées de part et d'autre de la date du jour (30 matchs par page). */
const MATCH_PAGES = Number(process.env.ALLSPORTS_MATCH_PAGES ?? 4);

const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
let quotaRemaining: number | null = null;
/** Remaining daily calls from the most recent RapidAPI response, never inferred. */
export const getQuotaRemaining = () => quotaRemaining;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function apiKey(): string {
  if (!process.env.ALLSPORTS_API_KEY) {
    try {
      process.loadEnvFile?.();
    } catch {
      /* La clé manquante est signalée juste après. */
    }
  }
  const key = process.env.ALLSPORTS_API_KEY?.trim();
  if (!key) throw new Error("ALLSPORTS_API_KEY absente : copiez la clé RapidAPI AllSportsApi dans .env.");
  return key;
}

/**
 * Registre de quota partagé entre processus (100 requêtes/24 h) et respect du
 * débit de 5 requêtes/seconde. Le répertoire est dérivé de l'empreinte SHA-256
 * de la clé : aucun secret n'est écrit sur le disque.
 */
async function reserveRequest(key: string): Promise<void> {
  const directory = path.join(tmpdir(), "promptsport-allsports", createHash("sha256").update(key).digest("hex"));
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, "lock");
  const ledger = path.join(directory, "requests.json");
  const deadline = Date.now() + 60000;

  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 120000) await rmdir(lock);
      } catch {
        /* Un autre processus a libéré le verrou. */
      }
      if (Date.now() > deadline) throw new Error("AllSportsApi : une autre synchronisation réserve le quota. Réessayez plus tard.");
      await sleep(100);
    }
  }

  try {
    let requests: number[] = [];
    try {
      const stored: unknown = JSON.parse(await readFile(ledger, "utf8"));
      if (!Array.isArray(stored) || !stored.every((item) => typeof item === "number" && Number.isFinite(item))) {
        throw new Error("Registre de quota invalide.");
      }
      requests = stored as number[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    requests = requests.filter((timestamp) => timestamp > Date.now() - DAY);
    if (requests.length >= 100) throw new Error("AllSportsApi : limite locale de 100 requêtes sur 24 heures atteinte.");
    const wait = (requests.at(-1) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    requests.push(Date.now());
    await writeFile(ledger, JSON.stringify(requests), { mode: 0o600 });
  } finally {
    await rmdir(lock);
  }
}

/** Appel API avec cache en mémoire (30 s pour le direct, 5 min sinon). */
export type SyncRequestOptions = { deadline?: number; attempts?: number; tournamentId?: number };

/** Durable quota shared by CLI, cron and all serverless instances. */
async function reserveSharedRequest(key: string, endpoint: string, automatic = false): Promise<string> {
  const keyHash = createHash("sha256").update(key).digest("hex");
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(190021)`;
    const where = { type: "request", startedAt: { gt: new Date(Date.now() - DAY) }, errors: { path: ["keyHash"], equals: keyHash } };
    const used = await db.syncLog.count({ where });
    // Details share the global budget, with a smaller ceiling to protect scores.
    if (/\/api\/match\/\d+\/(incidents|statistics|lineups)$/.test(endpoint)) {
      const details = await db.syncLog.count({ where: { ...where, OR: ["incidents", "statistics", "lineups"].map(part => ({ errors: { path: ["endpoint"], string_ends_with: `/${part}` } })) } });
      if (details >= 30) throw new Error("AllSportsApi : budget détails de 30 appels sur 24 heures atteint.");
    }
    if (used >= (automatic ? 80 : 100)) throw new Error(automatic
      ? "AllSportsApi : budget automatique de 80 requêtes atteint ; 20 appels réservés aux interventions manuelles."
      : "AllSportsApi : budget partagé de 100 requêtes sur 24 heures atteint.");
    const last = await db.syncLog.findFirst({ where, orderBy: { startedAt: "desc" } });
    const lastResponse = await db.syncLog.findFirst({ where: { ...where, AND: [{ errors: { path: ["remaining"], gte: 0 } }] }, orderBy: { startedAt: "desc" } });
    if (lastResponse) {
      const metadata = lastResponse.errors as { remaining?: number; resetAt?: number };
      if ((!metadata.resetAt || metadata.resetAt > Date.now()) && metadata.remaining !== undefined && metadata.remaining <= (automatic ? 20 : 0)) throw new Error("AllSportsApi : réserve fournisseur préservée ou quota épuisé.");
    }
    if (last) {
      const metadata = last.errors as { remaining?: number; resetAt?: number };
      if (metadata.remaining === 0 && (!metadata.resetAt || metadata.resetAt > Date.now())) throw new Error("AllSportsApi : quota fournisseur épuisé.");
      if (automatic && metadata.remaining !== undefined && metadata.remaining <= 20 && (!metadata.resetAt || metadata.resetAt > Date.now())) throw new Error("AllSportsApi : réserve de 20 requêtes fournisseur préservée.");
      const wait = last.startedAt.getTime() + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
    }
    const row = await db.syncLog.create({ data: { type: "request", startedAt: new Date(), errors: { keyHash, endpoint }, status: "FAILED" } });
    return row.id;
  }, { timeout: 5000, maxWait: 3000 });
}

async function request<T>(endpoint: string, ttlMs = 300000, options: SyncRequestOptions = {}): Promise<T> {
  const key = apiKey();
  const url = `${BASE}${endpoint}`;
  const cacheKey = createHash("sha256").update(key).digest("hex") + url;
  const existing = cache.get(cacheKey);
  if (existing && existing.expires > Date.now()) return existing.value as Promise<T>;

  const value = (async () => {
    let lastError: Error | null = null;
    const attempts = options.attempts ?? MAX_ATTEMPTS;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (options.deadline && Date.now() + 5000 >= options.deadline) throw new Error("Synchronisation : limite de temps atteinte.");
      const budget = operationBudget.getStore();
      if (budget) {
        if (budget.remaining === 0) throw new Error("AllSportsApi : budget de cette opération atteint.");
        budget.remaining--; budget.reserved++;
      }
      // The filesystem limiter remains useful for local CLI processes only.
      if (!process.env.VERCEL) await reserveRequest(key);
      const requestId = await reserveSharedRequest(key, endpoint, options.deadline !== undefined || !!budget);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST },
          signal: AbortSignal.timeout(Math.max(1, Math.min(45000, options.deadline ? Math.min(15000, options.deadline - Date.now()) : 45000))),
          cache: "no-store",
        });
      } catch {
        lastError = new Error("AllSportsApi : erreur réseau ou délai de 45 secondes dépassé.");
        await sleep(500 * attempt);
        continue;
      }

      const remaining = response.headers.get("x-ratelimit-requests-remaining");
      if (remaining !== null && /^\d+$/.test(remaining)) quotaRemaining = Number(remaining);
      const reset = response.headers.get("x-ratelimit-requests-reset");
      await prisma.syncLog.update({ where: { id: requestId }, data: {
        finishedAt: new Date(), status: response.ok ? "SUCCESS" : "FAILED",
        errors: { keyHash: createHash("sha256").update(key).digest("hex"), endpoint,
          ...(remaining !== null && /^\d+$/.test(remaining) ? { remaining: Number(remaining) } : {}),
          ...(reset && /^\d+$/.test(reset) ? { resetAt: Date.now() + Number(reset) * 1000 } : {}),
        },
      } });
      if (!response.ok) {
        const detail =
          response.status === 429
            ? "quota dépassé (100 requêtes/jour)"
            : response.status === 401 || response.status === 403
              ? "vérifiez la clé RapidAPI et l'abonnement AllSportsApi"
              : response.status === 404
                ? "endpoint inconnu"
                : "service indisponible";
        const error = new AllSportsHttpError(response.status, `AllSportsApi HTTP ${response.status} (${endpoint}) : ${detail}.`);
        // Seules les erreurs passagères méritent une nouvelle tentative.
        if (response.status < 500) throw error;
        lastError = error;
        await sleep(500 * attempt);
        continue;
      }

      // The provider documents 204 when a detail layer is unavailable.
      if (response.status === 204 && /\/(incidents|statistics|lineups)$/.test(endpoint)) return { unavailable: true } as T;

      // Une réponse 200 au corps vide est déjà arrivée : on la traite comme une
      // erreur passagère plutôt que de laisser `json()` lever « Unexpected end of JSON input ».
      const text = await response.text();
      if (text.trim() === "") {
        lastError = new Error(`AllSportsApi ${endpoint} : réponse vide.`);
        await sleep(500 * attempt);
        continue;
      }
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        lastError = new Error(`AllSportsApi ${endpoint} : réponse illisible (JSON invalide).`);
        await sleep(500 * attempt);
        continue;
      }
      if (typeof payload?.message === "string") {
        throw new Error(`AllSportsApi ${endpoint} : ${payload.message}`);
      }
      return payload as T;
    }
    throw lastError ?? new Error(`AllSportsApi ${endpoint} : échec après ${MAX_ATTEMPTS} tentatives.`);
  })();

  cache.set(cacheKey, { value, expires: Date.now() + ttlMs });
  try {
    return await value;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

export const fetchSeasons = (tournamentId: number) =>
  request<{ seasons?: ApiSeason[] }>(`/api/tournament/${tournamentId}/seasons`).then((data) => data.seasons ?? []);

export const fetchTeams = (tournamentId: number, seasonId: number) =>
  request<{ teams?: ApiTeam[] }>(`/api/tournament/${tournamentId}/season/${seasonId}/teams`).then((data) => data.teams ?? []);

/**
 * Matchs d'une saison : pages « déjà joués » et « à venir » autour d'aujourd'hui.
 *
 * L'historique est parcouru jusqu'à sa dernière page pour calculer un classement
 * complet. Les prochains matchs restent limités au nombre de pages demandé.
 * Une page en erreur annule l'import : aucune suppression sur un jeu incomplet.
 */
export async function fetchMatches(tournamentId: number, seasonId: number, pages = MATCH_PAGES, completeHistory = true): Promise<ApiEvent[]> {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 50) throw new Error("ALLSPORTS_MATCH_PAGES doit être compris entre 1 et 50.");
  const events = new Map<number, ApiEvent>();
  for (const direction of ["last", "next"] as const) {
    const limit = direction === "last" ? (completeHistory ? 50 : 1) : pages;
    for (let page = 0; page < limit; page += 1) {
        const data = await request<{ events?: ApiEvent[]; hasNextPage?: boolean }>(
          `/api/tournament/${tournamentId}/season/${seasonId}/matches/${direction}/${page}`,
          direction === "last" ? 60000 : 300000,
        );
        if (!Array.isArray(data.events)) throw new Error(`AllSportsApi : page ${direction}/${page} invalide pour ${tournamentId}.`);
        for (const event of data.events) events.set(event.id, event);
        if (!data.events.length || data.hasNextPage === false || (data.hasNextPage === undefined && data.events.length < 30)) break;
        if (direction === "last" && completeHistory && page === limit - 1) throw new Error(`AllSportsApi : historique incomplet pour ${tournamentId}, import annulé.`);
    }
  }
  return [...events.values()];
}

/** Matchs en direct, toutes compétitions confondues. */
export const fetchLiveMatches = () =>
  request<{ events?: ApiEvent[] }>("/api/matches/live", 30000).then((data) => data.events ?? []);

/** AllSportsApi uses /api/matches/*, not API-Football's /fixtures. */
export async function fetchSyncEvents(date: string | null, options: SyncRequestOptions): Promise<ApiEvent[]> {
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date de synchronisation invalide.");
  // The provider retired its flat dated feed; schedules are per tournament.
  if (date && (!options.tournamentId || !Number.isSafeInteger(options.tournamentId))) throw new Error("Compétition requise pour les matchs datés.");
  const endpoint = date ? `/api/tournament/${options.tournamentId}/scheduled-events/${date}` : "/api/matches/live";
  const data = await request<{ events?: ApiEvent[] }>(endpoint, 300000, { ...options, attempts: 1 });
  if (!Array.isArray(data.events)) throw new Error("AllSportsApi : liste des matchs absente ou invalide.");
  return data.events;
}

/** A real 404 is distinguishable from quota, transport and malformed responses. */
export async function fetchMatchEvent(externalId: string, deadline: number): Promise<ApiEvent | null> {
  const id = Number(externalId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Identifiant AllSportsApi invalide.");
  try {
    const data = await request<{ event?: ApiEvent }>(`/api/match/${id}`, 300000, { deadline, attempts: 1 });
    if (!data.event || data.event.id !== id) throw new Error("AllSportsApi : fiche match absente ou invalide.");
    return data.event;
  } catch (error) {
    if (error instanceof AllSportsHttpError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Statuts AllSportsApi → `MatchStatus` (énumération Prisma).
 *
 * L'API expose `status.type` (`notstarted`, `inprogress`, `finished`,
 * `postponed`, `canceled`, `suspended`, `interrupted`) et une description
 * lisible (« 1st half », « Halftime », « Finished »…). Les deux sont examinés :
 * une description inattendue ne doit pas faire échouer tout l'import.
 */
export function mapMatchStatus(status: ApiEventStatus | string | null | undefined):
  | "SCHEDULED"
  | "LIVE"
  | "FINISHED"
  | "POSTPONED"
  | "CANCELLED" {
  const raw = typeof status === "string" ? status : `${status?.type ?? ""} ${status?.description ?? ""}`;
  const value = raw.trim().toLowerCase();

  if (/cancel/.test(value)) return "CANCELLED";
  if (/postpon|suspend|interrupt|abandon|awarded/.test(value)) return "POSTPONED";
  if (/finish|ended|after penalties|after extra time|ft\b/.test(value)) return "FINISHED";
  if (/inprogress|in_progress|live|1st half|2nd half|halftime|half time|1h\b|2h\b|ht\b|extra time|penalties/.test(value)) return "LIVE";
  if (/notstarted|not started|ns\b|scheduled|tbd|delayed|started/.test(value)) return "SCHEDULED";
  throw new Error(`Statut AllSportsApi inconnu : ${raw || "(vide)"}.`);
}

/** Résout un code de compétition (FL1, 34, ligue-1…) vers la clé interne. */
function resolveCode(input: string): keyof typeof LEAGUES {
  const upper = input.toUpperCase();
  const code = (Object.keys(LEAGUES) as Array<keyof typeof LEAGUES>).find(
    (candidate) =>
      candidate === upper ||
      String(LEAGUES[candidate].id) === input ||
      LEAGUES[candidate].slug === input.toLowerCase(),
  );
  if (!code) {
    throw new Error(`Compétition non prise en charge : ${input}. Utilisez ${Object.keys(LEAGUES).join(", ")}.`);
  }
  return code;
}

/**
 * Année de début d'une saison, pour un tri chronologique fiable.
 *
 * Les libellés d'AllSportsApi sont du type « 26/27 » (2026-2027) ou « 99/00 »
 * (1999-2000) : un tri sur la chaîne placerait « 99/00 » après « 26/27 » et
 * importerait la saison 1999-2000. On convertit donc en année sur quatre
 * chiffres, en supposant le XXIe siècle avant 70.
 */
function seasonStartYear(season: ApiSeason): number {
  const label = String(season.year ?? season.name ?? "");
  const fourDigits = label.match(/(19|20)\d{2}/);
  if (fourDigits) return Number(fourDigits[0]);
  const twoDigits = label.match(/^(\d{2})/);
  if (twoDigits) {
    const value = Number(twoDigits[1]);
    return value < 70 ? 2000 + value : 1900 + value;
  }
  return 0;
}

/** Saison demandée : `ALLSPORTS_SEASON=26/27` (ou 2026) sinon la plus récente. */
function pickSeason(seasons: ApiSeason[], code: string): ApiSeason {
  const requested = process.env.ALLSPORTS_SEASON?.trim();
  if (requested) {
    const match = seasons.find(
      (season) => String(season.year) === requested || String(seasonStartYear(season)) === requested,
    );
    if (!match) throw new Error(`${code} : saison ${requested} indisponible.`);
    return match;
  }
  const sorted = [...seasons].sort((a, b) => seasonStartYear(b) - seasonStartYear(a));
  const season = sorted[0];
  if (!season) throw new Error(`${code} : aucune saison disponible pour cette compétition.`);
  return season;
}

/**
 * Prépare une compétition : saison, équipes et matchs. N'écrit rien en base —
 * c'est ce qui permet un `--dry-run` complet.
 */
export async function prepareCompetition(input: string, options: { recentOnly?: boolean } = {}): Promise<PreparedCompetition> {
  const code = resolveCode(input);
  const league = LEAGUES[code];

  const seasons = await fetchSeasons(league.id);
  const season = pickSeason(seasons, code);
  const [teamResult, eventResult] = await Promise.allSettled([
    fetchTeams(league.id, season.id),
    fetchMatches(league.id, season.id, MATCH_PAGES, !options.recentOnly),
  ]);
  if (teamResult.status === "rejected") throw teamResult.reason;
  if (eventResult.status === "rejected") throw eventResult.reason;
  const teams = teamResult.value, events = eventResult.value;

  if (!teams.length || !events.length) {
    throw new Error(`${code} : équipes ou matchs absents pour ${season.year}. Vérifiez la saison demandée.`);
  }
  for (const team of [...teams, ...events.flatMap((event) => [event.homeTeam, event.awayTeam])]) {
    if (!Number.isSafeInteger(team?.id) || team.id <= 0 || !team.name) {
      throw new Error(`${code} : équipe invalide, import annulé.`);
    }
  }
  for (const event of events) {
    const date = new Date((event.startTimestamp ?? 0) * 1000);
    if (!Number.isSafeInteger(event.id) || event.id <= 0 || Number.isNaN(date.getTime())) {
      throw new Error(`${code} : match invalide, import annulé.`);
    }
    mapMatchStatus(event.status);
  }

  return { code, season, teams, events, completeHistory: !options.recentOnly };
}

/**
 * Garde-fou : les données sportives actuelles viennent d'un autre fournisseur
 * (football-data.org, identifiants 2001-2021). Importer AllSportsApi par-dessus
 * mélangerait deux référentiels ; la migration doit être une décision explicite.
 */
export async function assertMigrated(db: Prisma.TransactionClient = prisma): Promise<void> {
  const allowed = Object.values(LEAGUES).map((league) => String(league.id));
  const foreign = await db.competition.count({ where: { externalId: { not: null, notIn: allowed } } });
  if (foreign > 0) {
    throw new Error(
      "Des compétitions d'un autre fournisseur sont présentes (identifiants " +
        "football-data.org). La bascule vers AllSportsApi doit être confirmée explicitement : " +
        "sauvegardez la base puis exécutez le script de migration avant de synchroniser.",
    );
  }
}

/** Écrit une compétition préparée (compétition, équipes, matchs). */
export async function persistCompetition(
  db: Prisma.TransactionClient,
  prepared: PreparedCompetition,
): Promise<CompetitionSyncDetail> {
  const { code, season, teams, events } = prepared;
  const league = LEAGUES[code];
  const externalId = String(league.id);
  const data = {
    name: league.name,
    sport: "football",
    country: league.country,
    season: String(season.year),
  };
  const competition = await db.competition.upsert({
    where: { externalId },
    update: data,
    create: { ...data, externalId, slug: league.slug },
  });

  const allTeams = new Map<number, ApiTeam>();
  for (const event of events) {
    allTeams.set(event.homeTeam.id, event.homeTeam);
    allTeams.set(event.awayTeam.id, event.awayTeam);
  }
  for (const team of teams) allTeams.set(team.id, team);

  const ids = new Map<number, string>();
  for (const team of allTeams.values()) {
    const fields = {
      name: team.name,
      shortName: team.shortName ?? team.nameCode ?? null,
      // AllSportsApi ne fournit pas d'URL de logo exploitable côté navigateur.
      country: team.category?.country?.name ?? team.country?.name ?? league.country,
      sport: "football",
    };
    const row = await db.team.upsert({
      where: { externalId: String(team.id) },
      update: fields,
      create: { ...fields, logoUrl: null, externalId: String(team.id), slug: `${slugify(team.name) || "team"}-${team.id}` },
    });
    ids.set(team.id, row.id);
  }

  // Les classements sont calculés localement : on ne mélange pas les saisons.
  const matchIds = events.map((event) => String(event.id));
  const existingTimes = new Map((await db.match.findMany({ where: { externalId: { in: matchIds } }, select: { externalId: true, startedAt: true, finishedAt: true } })).map(match => [match.externalId, match]));
  if (prepared.completeHistory !== false) await db.match.deleteMany({ where: { competitionId: competition.id, externalId: { not: null, notIn: matchIds } } });

  let matches = 0;
  for (const event of events) {
    const homeId = ids.get(event.homeTeam.id);
    const awayId = ids.get(event.awayTeam.id);
    if (!homeId || !awayId) continue;
    const status = mapMatchStatus(event.status);
    const existing = existingTimes.get(String(event.id));
    const fields = {
      competitionId: competition.id,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledAt: new Date(event.startTimestamp * 1000),
      homeScore: event.homeScore?.current ?? null,
      awayScore: event.awayScore?.current ?? null,
      status,
      startedAt: existing?.startedAt ?? (status === "LIVE" || status === "FINISHED" ? new Date(event.startTimestamp * 1000) : null),
      // Observation time of the terminal status, not an invented final whistle.
      finishedAt: existing?.finishedAt ?? (status === "FINISHED" ? new Date() : null),
      venue: event.venue?.stadium?.name ?? event.venue?.name ?? null,
    };
    await db.match.upsert({
      where: { externalId: String(event.id) },
      update: fields,
      create: { ...fields, externalId: String(event.id) },
    });
    matches += 1;
  }

  return { code, name: data.name, season: data.season, teams: allTeams.size, matches };
}

/** Synchronise une compétition (transaction + verrou consultatif). */
export async function syncCompetition(code: string): Promise<CompetitionSyncDetail> {
  apiKey();
  await assertMigrated();
  const prepared = await prepareCompetition(code);
  return prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(190020)`;
      await assertMigrated(db);
      return persistCompetition(db, prepared);
    },
    { timeout: 180000 },
  );
}

/** Synchronise plusieurs compétitions : une erreur n'interrompt pas les suivantes. */
export async function syncAllCompetitions(codes: readonly string[] = DEFAULT_COMPETITIONS): Promise<FootballSyncSummary> {
  const results: CompetitionSyncDetail[] = [];
  const errors: string[] = [];
  for (const code of codes) {
    try {
      results.push(await syncCompetition(code));
    } catch (error) {
      const message = `${COMPETITION_LABELS[code.toUpperCase()] ?? code} : ${error instanceof Error ? error.message : "Erreur inconnue"}`;
      errors.push(message);
      console.error(message);
    }
  }
  return {
    competitions: results.length,
    teams: results.reduce((sum, item) => sum + item.teams, 0),
    matches: results.reduce((sum, item) => sum + item.matches, 0),
    results,
    errors,
  };
}

export type MatchDetailPart = "events" | "stats" | "lineups";
type DetailMatch = { id: string; externalId: string | null; homeTeamId: string; awayTeamId: string; status: string };
type Person = { name?: string };
type Incident = { incidentType?: string; incidentClass?: string; isHome?: boolean; time?: number; benchTime?: number; addedTime?: number; player?: Person; playerName?: string; manager?: Person; assist1?: Person; playerIn?: Person; playerOut?: Person; rescinded?: boolean };
type StatItem = { key?: string; name?: string; home?: string | number; away?: string | number; homeValue?: number; awayValue?: number };
type LineupPlayer = { player?: Person & { position?: string }; position?: string; shirtNumber?: number; substitute?: boolean };
type ApiLineup = { formation?: string; coach?: Person; players?: LineupPlayer[] };
const detailEndpoints = { events: "incidents", stats: "statistics", lineups: "lineups" } as const;

/** Pure adapters: invalid responses never erase previously stored details. */
export function mapMatchEvents(incidents: Incident[], match: DetailMatch) {
  return incidents.flatMap(incident => {
    if (incident.rescinded) return [];
    const type = incident.incidentType === "goal" ? "GOAL" : ["penalty","inGamePenalty"].includes(incident.incidentType ?? "") && ["missed","miss"].includes(incident.incidentClass ?? "") ? "MISSED_PENALTY" : incident.incidentType === "substitution" ? "SUBSTITUTION" : incident.incidentType === "card" ? (incident.incidentClass === "yellow" ? "YELLOW_CARD" : ["red", "yellowRed"].includes(incident.incidentClass ?? "") ? "RED_CARD" : null) : null;
    if (!type) return [];
    // Shoot-out attempts are not match goals; team/clock must be explicit.
    const minute = incident.time !== undefined && incident.time < 0 ? incident.benchTime : incident.time;
    if (typeof incident.isHome !== "boolean" || !Number.isInteger(minute) || minute! < 0) throw new Error("Événement AllSports incomplet.");
    const playerName = (type === "SUBSTITUTION" ? incident.playerIn?.name : incident.player?.name ?? (incident.manager?.name ? `${incident.manager.name} (entraîneur)` : incident.playerName))?.trim();
    if (!playerName) throw new Error("Joueur AllSports absent.");
    return [{ matchId: match.id, teamId: incident.isHome ? match.homeTeamId : match.awayTeamId, type: type as "GOAL" | "MISSED_PENALTY" | "YELLOW_CARD" | "RED_CARD" | "SUBSTITUTION", playerName, assistName: (type === "SUBSTITUTION" ? incident.playerOut?.name : incident.assist1?.name) ?? null, minute: minute!, extraMinute: Number.isInteger(incident.addedTime) && incident.addedTime! > 0 ? incident.addedTime! : null }];
  });
}

export function mapMatchStatistics(statistics: { period?: string; groups?: { statisticsItems?: StatItem[] }[] }[], match: DetailMatch) {
  const all = statistics.find(period => period.period === "ALL");
  if (!all) return [];
  const items = all.groups?.flatMap(group => group.statisticsItems ?? []) ?? [];
  const keys = { possession: "ballPossession", shots: "totalShotsOnGoal", shotsOnTarget: "shotsOnTarget", corners: "cornerKicks", fouls: "fouls", yellowCards: "yellowCards", redCards: "redCards" } as const;
  return (["home", "away"] as const).map(side => {
    const values = Object.fromEntries(Object.entries(keys).map(([field, key]) => {
      const item = items.find(item => item.key === key);
      const raw = item?.[`${side}Value`] ?? item?.[side];
      const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+(\.\d+)?%?$/.test(raw) ? Number(raw.replace("%", "")) : null;
      if (value !== null && (!Number.isFinite(value) || value < 0 || (field === "possession" ? value > 100 : !Number.isInteger(value)))) throw new Error("Statistique AllSports invalide.");
      return [field, value];
    })) as { possession: number | null; shots: number | null; shotsOnTarget: number | null; corners: number | null; fouls: number | null; yellowCards: number | null; redCards: number | null };
    return { matchId: match.id, teamId: side === "home" ? match.homeTeamId : match.awayTeamId, ...values };
  }).filter(row => Object.keys(keys).some(key => row[key as keyof typeof keys] !== null));
}

export function mapMatchLineups(data: { home?: ApiLineup; away?: ApiLineup }, match: DetailMatch) {
  return (["home", "away"] as const).flatMap(side => {
    const lineup = data[side];
    if (!lineup?.players?.length) return [];
    const players = lineup.players.map(player => {
      if (!player.player?.name?.trim() || typeof player.substitute !== "boolean") throw new Error("Composition AllSports invalide.");
      return { name: player.player.name, number: Number.isInteger(player.shirtNumber) ? player.shirtNumber! : null, position: player.position ?? player.player.position ?? null, substitute: player.substitute };
    });
    return [{ matchId: match.id, teamId: side === "home" ? match.homeTeamId : match.awayTeamId, formation: lineup.formation ?? null, coach: lineup.coach?.name ?? null, starters: players.filter(player => !player.substitute), substitutes: players.filter(player => player.substitute) }];
  });
}

/** Never called by public pages. Durable claims also prevent concurrent cron calls. */
export async function syncMatchDetails(match: DetailMatch, include: readonly MatchDetailPart[], deadline = Date.now() + 55000) {
  const result = { synced: 0, errors: [] as string[] };
  if (!match.externalId || !/^\d+$/.test(match.externalId) || !["LIVE", "FINISHED"].includes(match.status)) return result;
  for (const part of [...new Set(include)]) {
    if (Date.now() + 5000 >= deadline) break;
    const type = `details:${match.id}:${part}`;
    const claim = await prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(190023)`;
      const recent = await db.syncLog.findFirst({ where: { type }, orderBy: { startedAt: "desc" } });
      if (recent && ((!recent.finishedAt && recent.startedAt.getTime() > Date.now() - 65000) || (recent.finishedAt && recent.startedAt.getTime() > Date.now() - 3600000 && recent.status === "FAILED") || (recent.status === "SUCCESS" && (match.status === "FINISHED" && (recent.errors as { final?: boolean }).final || recent.startedAt.getTime() > Date.now() - 300000)))) return null;
      return db.syncLog.create({ data: { type, status: "FAILED" } });
    });
    if (!claim) continue;
    try {
      const data = await request<Record<string, unknown>>(`/api/match/${match.externalId}/${detailEndpoints[part]}`, 300000, { deadline, attempts: 1 });
      let available = false;
      await prisma.$transaction(async db => {
        if (!data.unavailable) {
          if (part === "events") {
            if (!Array.isArray(data.incidents)) throw new Error("Réponse événements AllSports invalide.");
            const rows = mapMatchEvents(data.incidents, match);
            await db.matchEvent.deleteMany({ where: { matchId: match.id } });
            if (rows.length) await db.matchEvent.createMany({ data: rows });
            available = true; // A scoreless, cardless match is a valid empty timeline.
          } else if (part === "stats") {
            if (!Array.isArray(data.statistics)) throw new Error("Réponse statistiques AllSports invalide.");
            const rows = mapMatchStatistics(data.statistics, match);
            for (const row of rows) await db.matchStatistics.upsert({ where: { matchId_teamId: { matchId: row.matchId, teamId: row.teamId } }, create: row, update: row });
            available = rows.length === 2;
          } else {
            if (!data.home && !data.away) throw new Error("Réponse compositions AllSports invalide.");
            const rows = mapMatchLineups(data as { home?: ApiLineup; away?: ApiLineup }, match);
            for (const row of rows) await db.matchLineup.upsert({ where: { matchId_teamId: { matchId: row.matchId, teamId: row.teamId } }, create: row, update: row });
            available = rows.length === 2;
          }
        }
        await db.syncLog.update({ where: { id: claim.id }, data: { finishedAt: new Date(), status: available ? "SUCCESS" : "FAILED", matchesSynced: available ? 1 : 0, errors: { final: match.status === "FINISHED", available } } });
      });
      if (available) result.synced++;
    } catch (error) {
      result.errors.push(`${match.id}/${part} : ${error instanceof Error ? error.message : "Erreur inconnue"}`);
      await prisma.syncLog.update({ where: { id: claim.id }, data: { finishedAt: new Date(), status: "FAILED" } });
      if (/budget|quota|réserve|limite de temps/i.test(result.errors.at(-1)!)) break;
    }
  }
  return result;
}

export async function syncEligibleMatchDetails(include: readonly MatchDetailPart[], deadline: number, scope: "all" | "live" = "all") {
  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0); midnight.setUTCDate(midnight.getUTCDate() - 1);
  const end = new Date(midnight); end.setUTCDate(end.getUTCDate() + 2);
  const matches = await prisma.match.findMany({ where: { competition: { externalId: { in: Object.values(LEAGUES).map(league => String(league.id)) } }, externalId: { not: null }, OR: scope === "live" ? [{ status: "LIVE" }] : [{ status: "LIVE" }, { status: "FINISHED", scheduledAt: { gte: midnight, lt: end } }] }, select: { id: true, externalId: true, homeTeamId: true, awayTeamId: true, status: true }, orderBy: { scheduledAt: "asc" } });
  const result = { synced: 0, errors: [] as string[] };
  for (const match of matches) {
    if (Date.now() + 5000 >= deadline) break;
    const detail = await syncMatchDetails(match, include, deadline);
    result.synced += detail.synced; result.errors.push(...detail.errors);
    if (detail.errors.some(error => /budget|quota|réserve/i.test(error))) break;
  }
  return result;
}

type ProviderStanding = { team: { id: number; name: string }; position: number; matches: number; wins: number; draws: number; losses: number; scoresFor: number; scoresAgainst: number; points: number };
type StoredStandings = { seasonId: number; seasonLabel: string; rows: StandingRow[] };

export function mapLeaguePhaseStandings(payload: { standings?: { type?: string; name?: string; rows?: ProviderStanding[] }[] }): StandingRow[] {
  const table = payload.standings?.find(table => table.type === "total" && table.rows?.length === 36 && !/qualification|playoff/i.test(table.name ?? ""));
  if (!table?.rows) throw new Error("Classement de la phase de ligue absent ; aucun classement des qualifications ne sera utilisé.");
  const sorted = [...table.rows].sort((a,b)=>a.position-b.position);
  return sorted.map((row,index) => {
    if (row.position !== index + 1 || !Number.isSafeInteger(row.team?.id) || !row.team.name || ![row.matches,row.wins,row.draws,row.losses,row.scoresFor,row.scoresAgainst,row.points].every(value=>Number.isSafeInteger(value)&&value>=0) || row.matches !== row.wins+row.draws+row.losses) throw new Error("Classement fournisseur invalide.");
    return { teamId: String(row.team.id), teamName: row.team.name, played: row.matches, won: row.wins, drawn: row.draws, lost: row.losses, goalsFor: row.scoresFor, goalsAgainst: row.scoresAgainst, goalDifference: row.scoresFor-row.scoresAgainst, points: row.points };
  });
}

/** Only the sync job fetches standings; public pages read this durable snapshot. */
export async function syncChampionsLeagueStandings(seasonId: number, seasonLabel: string, deadline = Date.now()+55000) {
  const recent = await prisma.syncLog.findFirst({where:{type:"standings:7",status:"SUCCESS",finishedAt:{gt:new Date(Date.now()-DAY)},errors:{path:["seasonLabel"],equals:seasonLabel}},orderBy:{finishedAt:"desc"}});
  if (recent) return { synced: false };
  const payload = await request<{standings?: {type?:string;name?:string;rows?:ProviderStanding[]}[]}>(`/api/tournament/7/season/${seasonId}/standings/total`,DAY,{deadline,attempts:1});
  const rows = mapLeaguePhaseStandings(payload);
  await prisma.syncLog.create({data:{type:"standings:7",status:"SUCCESS",finishedAt:new Date(),errors:{seasonId,seasonLabel,rows}}});
  return { synced:true };
}

export async function getStoredChampionsLeagueStandings(seasonLabel: string | null) {
  if (!seasonLabel) return null;
  const log = await prisma.syncLog.findFirst({where:{type:"standings:7",status:"SUCCESS",errors:{path:["seasonLabel"],equals:seasonLabel}},orderBy:{finishedAt:"desc"}});
  if (!log) return null;
  const snapshot = log.errors as unknown as StoredStandings;
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== 36) return null;
  const teams = await prisma.team.findMany({where:{externalId:{in:snapshot.rows.map(row=>row.teamId)}},select:{id:true,externalId:true,logoUrl:true}});
  const logos: Record<string,string|null> = {};
  const rows = snapshot.rows.map(row=>{const team=teams.find(team=>team.externalId===row.teamId);const id=team?.id??`allsports:${row.teamId}`;logos[id]=team?.logoUrl??`https://img.sofascore.com/api/v1/team/${row.teamId}/image`;return {...row,teamId:id};});
  return {rows,logos,updatedAt:log.finishedAt};
}
