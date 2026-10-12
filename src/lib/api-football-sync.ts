import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rmdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import type { Prisma } from "@/generated/prisma/client";

export const LEAGUES = {
  FL1: { id: 61, name: "Ligue 1", slug: "ligue-1" },
  PL: { id: 39, name: "Premier League", slug: "premier-league" },
  PD: { id: 140, name: "La Liga", slug: "primera-division" },
  SA: { id: 135, name: "Serie A", slug: "serie-a" },
  BL1: { id: 78, name: "Bundesliga", slug: "bundesliga" },
  CL: { id: 2, name: "Champions League", slug: "uefa-champions-league" },
} as const;
export const DEFAULT_COMPETITIONS = Object.keys(LEAGUES);
export const COMPETITION_LABELS: Record<string, string> = Object.fromEntries(Object.entries(LEAGUES).map(([code, league]) => [code, league.name]));
export type CompetitionSyncDetail = { code: string; name: string; teams: number; matches: number };
export type FootballSyncSummary = { competitions: number; teams: number; matches: number; results: CompetitionSyncDetail[]; errors: string[] };
export type ApiLeague = { league: { id: number; name: string }; country: { name: string }; seasons: { year: number; start: string; end: string; current: boolean }[] };
export type ApiTeam = { id: number; name: string; code?: string | null; logo: string | null; country?: string | null };
export type ApiFixture = { fixture: { id: number; date: string; status: { short: string }; venue: { name: string | null } }; league: { id: number; season: number }; teams: { home: ApiTeam; away: ApiTeam }; goals: { home: number | null; away: number | null } };
export type PreparedCompetition = { code: keyof typeof LEAGUES; league: ApiLeague; season: ApiLeague["seasons"][number]; teams: ApiTeam[]; matches: ApiFixture[] };
const BASE = "https://v3.football.api-sports.io";
const DAY = 86400000;
const cache = new Map<string, { expires: number; value: Promise<unknown[]> }>();
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function apiKey() {
  if (!process.env.API_FOOTBALL_KEY) { try { process.loadEnvFile?.(); } catch { /* Config checked below. */ } }
  const key = process.env.API_FOOTBALL_KEY?.trim();
  if (!key) throw new Error("API_FOOTBALL_KEY absente : copiez la clé API-Sports directe depuis Account → My Access dans .env.");
  return key;
}

/** Shared across CLI/dev processes on this host. Reservations survive restarts.
 * No key is written: the directory name contains its SHA-256 digest only. */
async function reserveRequest(key: string) {
  const directory = path.join(tmpdir(), "promptsport-api-football", createHash("sha256").update(key).digest("hex"));
  await mkdir(directory, { recursive: true });
  const lock = path.join(directory, "lock"), ledger = path.join(directory, "requests.json");
  const deadline = Date.now() + 60000;
  while (true) {
    try { await mkdir(lock); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 120000) await rmdir(lock); } catch { /* Another process recovered the lock. */ }
      if (Date.now() > deadline) throw new Error("API-Football : une autre synchronisation réserve le quota. Réessayez plus tard.");
      await sleep(100);
    }
  }
  try {
    let requests: number[] = [];
    try {
      const stored: unknown = JSON.parse(await readFile(ledger, "utf8"));
      if (!Array.isArray(stored) || !stored.every(item => typeof item === "number" && Number.isFinite(item))) throw new Error("Registre de quota invalide.");
      requests = stored;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    requests = requests.filter(timestamp => timestamp > Date.now() - DAY);
    if (requests.length >= 100) throw new Error("API-Football : limite locale de 100 requêtes sur 24 heures atteinte.");
    const wait = (requests.at(-1) ?? 0) + 7000 - Date.now();
    if (wait > 0) await sleep(wait);
    requests.push(Date.now());
    await writeFile(ledger, JSON.stringify(requests), { mode: 0o600 });
  } finally { await rmdir(lock); }
}

async function request<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T[]> {
  const key = apiKey();
  const query = new URLSearchParams(Object.entries(params).map(([name, value]) => [name, String(value)]));
  query.sort();
  const url = `${BASE}${endpoint}?${query}`;
  const cacheKey = createHash("sha256").update(key).digest("hex") + url;
  const existing = cache.get(cacheKey);
  if (existing && existing.expires > Date.now()) return existing.value as Promise<T[]>;
  const value = (async () => {
    await reserveRequest(key);
    let response: Response;
    try { response = await fetch(url, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(30000), cache: "no-store" }); }
    catch { throw new Error("API-Football : erreur réseau ou délai de 30 secondes dépassé."); }
    if (!response.ok) throw new Error(`API-Football HTTP ${response.status} : ${response.status === 429 ? "quota dépassé" : response.status === 401 || response.status === 403 ? "vérifiez la clé et l’accès API-Sports direct" : "service indisponible"}.`);
    const data = await response.json();
    if (data.errors && Object.keys(data.errors).length) {
      const detail = JSON.stringify(data.errors).replaceAll(key, "[clé masquée]").slice(0, 400);
      throw new Error(`API-Football ${endpoint} : ${detail}`);
    }
    if (!Array.isArray(data.response)) throw new Error("API-Football : réponse invalide.");
    // These three endpoints normally return all rows; never silently truncate.
    if (data.paging?.total > 1) throw new Error(`API-Football ${endpoint} : réponse paginée inattendue, import annulé.`);
    return data.response as T[];
  })();
  cache.set(cacheKey, { value, expires: Date.now() + (endpoint === "/fixtures" ? 30000 : 300000) });
  try { return await value; } catch (error) { cache.delete(cacheKey); throw error; }
}

export const fetchCompetitions = () => request<ApiLeague>("/leagues");
export async function fetchTeams(leagueId: number, season: number) {
  return (await request<{ team: ApiTeam }>("/teams", { league: leagueId, season })).map(row => row.team);
}
export const fetchMatches = (leagueId: number, season: number, from: string, to: string) => request<ApiFixture>("/fixtures", { league: leagueId, season, from, to, timezone: "UTC" });

export function mapMatchStatus(status: string): "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED" {
  switch (status) {
    case "NS": case "TBD": return "SCHEDULED";
    case "1H": case "HT": case "2H": case "ET": case "BT": case "P": case "LIVE": return "LIVE";
    case "FT": case "AET": case "PEN": case "AWD": case "WO": return "FINISHED";
    case "PST": case "SUSP": case "INT": return "POSTPONED";
    case "CANC": case "ABD": return "CANCELLED";
    default: throw new Error(`Statut API-Football inconnu : ${status}.`);
  }
}

export async function prepareCompetition(input: string): Promise<PreparedCompetition> {
  const code = (Object.keys(LEAGUES).find(code => code === input.toUpperCase() || String(LEAGUES[code as keyof typeof LEAGUES].id) === input)) as keyof typeof LEAGUES | undefined;
  if (!code) throw new Error(`Compétition non prise en charge : ${input}. Utilisez ${DEFAULT_COMPETITIONS.join(", ")}.`);
  const league = (await fetchCompetitions()).find(item => item.league.id === LEAGUES[code].id);
  if (!league) throw new Error(`${code} : ligue absente de la réponse API.`);
  const requestedSeason = process.env.API_FOOTBALL_SEASON;
  if (requestedSeason && !/^\d{4}$/.test(requestedSeason)) throw new Error("API_FOOTBALL_SEASON doit contenir une année sur quatre chiffres.");
  const season = league.seasons.find(item => requestedSeason ? item.year === Number(requestedSeason) : item.current);
  if (!season) throw new Error(`${code} : saison ${requestedSeason || "courante"} indisponible. Aucun repli automatique vers une ancienne saison.`);
  const teams = await fetchTeams(league.league.id, season.year);
  const matches = await fetchMatches(league.league.id, season.year, season.start.slice(0, 10), season.end.slice(0, 10));
  if (!teams.length || !matches.length) throw new Error(`${code} : équipes ou matchs absents pour ${season.year}. Vérifiez les saisons accessibles avec votre abonnement.`);
  for (const team of [...teams, ...matches.flatMap(match => [match.teams.home, match.teams.away])]) {
    if (!Number.isSafeInteger(team?.id) || team.id <= 0 || !team.name) throw new Error(`${code} : équipe invalide, import annulé.`);
  }
  for (const match of matches) {
    if (!Number.isSafeInteger(match.fixture.id) || match.fixture.id <= 0 || !Number.isFinite(Date.parse(match.fixture.date)) || match.league.id !== league.league.id || match.league.season !== season.year) throw new Error(`${code} : match invalide, import annulé.`);
    mapMatchStatus(match.fixture.status.short);
  }
  return { code, league, season, teams, matches };
}

/** Prevent collisions between numeric IDs from the two different providers. */
export async function assertMigrated(db: Prisma.TransactionClient = prisma) {
  const allowed = Object.values(LEAGUES).map(league => String(league.id));
  const legacy = await db.competition.count({ where: { externalId: { not: null, notIn: allowed } } });
  const orphaned = await db.competition.count() === 0 && (await db.team.count()) > 0;
  if (legacy || orphaned) throw new Error("Anciennes données sportives détectées. Exécutez d’abord scripts/migrate-sports-data.ts après validation de la sauvegarde et de la suppression.");
}

export async function persistCompetition(db: Prisma.TransactionClient, prepared: PreparedCompetition): Promise<CompetitionSyncDetail> {
  const { code, league, season, teams, matches } = prepared;
  const externalId = String(league.league.id);
  const data = { name: league.league.name, sport: "football", country: league.country.name, season: String(season.year) };
  const competition = await db.competition.upsert({ where: { externalId }, update: data, create: { ...data, externalId, slug: LEAGUES[code].slug } });
  const allTeams = new Map<number, ApiTeam>();
  for (const match of matches) for (const team of [match.teams.home, match.teams.away]) allTeams.set(team.id, team);
  for (const team of teams) allTeams.set(team.id, team);
  const ids = new Map<number, string>();
  for (const team of allTeams.values()) {
    const fields = { name: team.name, shortName: team.code ?? null, logoUrl: team.logo, country: team.country ?? null, sport: "football" };
    const row = await db.team.upsert({ where: { externalId: String(team.id) }, update: fields, create: { ...fields, externalId: String(team.id), slug: `${slugify(team.name) || "team"}-${team.id}` } });
    ids.set(team.id, row.id);
  }
  // Standings are computed locally: do not mix previous and current seasons.
  const matchIds = matches.map(match => String(match.fixture.id));
  await db.match.deleteMany({ where: { competitionId: competition.id, externalId: { not: null, notIn: matchIds } } });
  for (const match of matches) {
    const fields = { competitionId: competition.id, homeTeamId: ids.get(match.teams.home.id)!, awayTeamId: ids.get(match.teams.away.id)!, scheduledAt: new Date(match.fixture.date), homeScore: match.goals.home, awayScore: match.goals.away, status: mapMatchStatus(match.fixture.status.short), venue: match.fixture.venue?.name ?? null };
    await db.match.upsert({ where: { externalId: String(match.fixture.id) }, update: fields, create: { ...fields, externalId: String(match.fixture.id) } });
  }
  return { code, name: data.name, teams: allTeams.size, matches: matches.length };
}

export async function syncCompetition(code: string): Promise<CompetitionSyncDetail> {
  apiKey();
  await assertMigrated();
  const prepared = await prepareCompetition(code);
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(190019)`;
    await assertMigrated(db);
    return persistCompetition(db, prepared);
  }, { timeout: 120000 });
}
export async function syncAllCompetitions(codes: readonly string[] = DEFAULT_COMPETITIONS): Promise<FootballSyncSummary> {
  const results: CompetitionSyncDetail[] = [], errors: string[] = [];
  for (const code of codes) {
    try { results.push(await syncCompetition(code)); }
    catch (error) { const message = `${COMPETITION_LABELS[code] ?? code} : ${error instanceof Error ? error.message : "Erreur inconnue"}`; errors.push(message); console.error(message); }
  }
  return { competitions: results.length, teams: results.reduce((sum, item) => sum + item.teams, 0), matches: results.reduce((sum, item) => sum + item.matches, 0), results, errors };
}
