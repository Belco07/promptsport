import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import type { Prisma } from "@/generated/prisma/client";

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

/** Compétitions suivies : identifiants de tournoi AllSportsApi (validation Phase 1). */
export const LEAGUES = {
  FL1: { id: 34, name: "Ligue 1", slug: "ligue-1", country: "France" },
  PL: { id: 17, name: "Premier League", slug: "premier-league", country: "Angleterre" },
  PD: { id: 8, name: "LaLiga", slug: "liga", country: "Espagne" },
  SA: { id: 23, name: "Serie A", slug: "serie-a", country: "Italie" },
  BL1: { id: 35, name: "Bundesliga", slug: "bundesliga", country: "Allemagne" },
  CL: { id: 7, name: "UEFA Champions League", slug: "uefa-champions-league", country: "Europe" },
} as const;

export const DEFAULT_COMPETITIONS = Object.keys(LEAGUES);
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
};
export type PreparedCompetition = {
  code: keyof typeof LEAGUES;
  season: ApiSeason;
  teams: ApiTeam[];
  events: ApiEvent[];
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
async function request<T>(endpoint: string, ttlMs = 300000): Promise<T> {
  const key = apiKey();
  const url = `${BASE}${endpoint}`;
  const cacheKey = createHash("sha256").update(key).digest("hex") + url;
  const existing = cache.get(cacheKey);
  if (existing && existing.expires > Date.now()) return existing.value as Promise<T>;

  const value = (async () => {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await reserveRequest(key);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { "x-rapidapi-key": key, "x-rapidapi-host": HOST },
          signal: AbortSignal.timeout(45000),
          cache: "no-store",
        });
      } catch {
        lastError = new Error("AllSportsApi : erreur réseau ou délai de 45 secondes dépassé.");
        await sleep(500 * attempt);
        continue;
      }

      const remaining = response.headers.get("x-ratelimit-requests-remaining");
      if (remaining !== null && /^\d+$/.test(remaining)) quotaRemaining = Number(remaining);
      if (!response.ok) {
        const detail =
          response.status === 429
            ? "quota dépassé (100 requêtes/jour)"
            : response.status === 401 || response.status === 403
              ? "vérifiez la clé RapidAPI et l'abonnement AllSportsApi"
              : response.status === 404
                ? "endpoint inconnu"
                : "service indisponible";
        const error = new Error(`AllSportsApi HTTP ${response.status} (${endpoint}) : ${detail}.`);
        // Seules les erreurs passagères méritent une nouvelle tentative.
        if (response.status < 500) throw error;
        lastError = error;
        await sleep(500 * attempt);
        continue;
      }

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
export async function fetchMatches(tournamentId: number, seasonId: number, pages = MATCH_PAGES): Promise<ApiEvent[]> {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > 50) throw new Error("ALLSPORTS_MATCH_PAGES doit être compris entre 1 et 50.");
  const events = new Map<number, ApiEvent>();
  for (const direction of ["last", "next"] as const) {
    const limit = direction === "last" ? 50 : pages;
    for (let page = 0; page < limit; page += 1) {
        const data = await request<{ events?: ApiEvent[]; hasNextPage?: boolean }>(
          `/api/tournament/${tournamentId}/season/${seasonId}/matches/${direction}/${page}`,
          direction === "last" ? 60000 : 300000,
        );
        if (!Array.isArray(data.events)) throw new Error(`AllSportsApi : page ${direction}/${page} invalide pour ${tournamentId}.`);
        for (const event of data.events) events.set(event.id, event);
        if (!data.events.length || data.hasNextPage === false || (data.hasNextPage === undefined && data.events.length < 30)) break;
        if (direction === "last" && page === limit - 1) throw new Error(`AllSportsApi : historique incomplet pour ${tournamentId}, import annulé.`);
    }
  }
  return [...events.values()];
}

/** Matchs en direct, toutes compétitions confondues. */
export const fetchLiveMatches = () =>
  request<{ events?: ApiEvent[] }>("/api/matches/live", 30000).then((data) => data.events ?? []);

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
    throw new Error(`Compétition non prise en charge : ${input}. Utilisez ${DEFAULT_COMPETITIONS.join(", ")}.`);
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
export async function prepareCompetition(input: string): Promise<PreparedCompetition> {
  const code = resolveCode(input);
  const league = LEAGUES[code];

  const seasons = await fetchSeasons(league.id);
  const season = pickSeason(seasons, code);
  const [teams, events] = await Promise.all([
    fetchTeams(league.id, season.id),
    fetchMatches(league.id, season.id),
  ]);

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

  return { code, season, teams, events };
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
  await db.match.deleteMany({ where: { competitionId: competition.id, externalId: { not: null, notIn: matchIds } } });

  let matches = 0;
  for (const event of events) {
    const homeId = ids.get(event.homeTeam.id);
    const awayId = ids.get(event.awayTeam.id);
    if (!homeId || !awayId) continue;
    const fields = {
      competitionId: competition.id,
      homeTeamId: homeId,
      awayTeamId: awayId,
      scheduledAt: new Date(event.startTimestamp * 1000),
      homeScore: event.homeScore?.current ?? null,
      awayScore: event.awayScore?.current ?? null,
      status: mapMatchStatus(event.status),
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
