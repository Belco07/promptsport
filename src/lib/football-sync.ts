import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { COMPETITION_LABELS, DEFAULT_COMPETITIONS } from "@/lib/sports";

/**
 * Service de synchronisation Football-Data.org (WP6e).
 *
 * Remplace l'ancien service TheSportsDB. API gratuite (plan « free ») :
 * 12 compétitions, 10 requêtes/minute. La clé se crée sur
 * https://www.football-data.org/client/register et se place dans
 * FOOTBALL_DATA_API_KEY (.env).
 */

const API_BASE = "https://api.football-data.org/v4";

// Réexportés depuis ./sports (module sans dépendance serveur, importable côté
// client) pour rester la source de vérité de ce service.
export { COMPETITION_LABELS, DEFAULT_COMPETITIONS };

const RATE_LIMIT_MS = 6000; // 10 requêtes/minute

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Horodatage du dernier appel API (espacement global des requêtes). */
let lastRequestAt = 0;

/**
 * Respecte le rate limiting : espace chaque appel d'au moins 6 s.
 * Le tout premier appel n'est pas retardé.
 */
async function throttle(): Promise<void> {
  const now = Date.now();
  if (lastRequestAt !== 0) {
    const wait = RATE_LIMIT_MS - (now - lastRequestAt);
    if (wait > 0) {
      await sleep(wait);
    }
  }
  lastRequestAt = Date.now();
}

/** Récupère la clé API ; complète depuis .env si nécessaire (exécution CLI). */
function getApiKey(): string {
  let key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) {
    const loadEnvFile = (
      process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }
    ).loadEnvFile;
    if (typeof loadEnvFile === "function") {
      try {
        loadEnvFile();
      } catch {
        // .env absent : on laisse le message ci-dessous parler.
      }
    }
    key = process.env.FOOTBALL_DATA_API_KEY;
  }
  if (!key) {
    throw new Error(
      "FOOTBALL_DATA_API_KEY n'est pas configurée. Créez une clé gratuite sur https://www.football-data.org/client/register puis ajoutez-la dans .env.",
    );
  }
  return key;
}

async function fetchApi<T>(path: string): Promise<T> {
  const key = getApiKey();
  await throttle();

  const url = `${API_BASE}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "X-Auth-Token": key,
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new Error(
      `Impossible de joindre Football-Data.org (${error instanceof Error ? error.message : "erreur réseau"}).`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "Clé API Football-Data.org invalide ou expirée (HTTP 401). Vérifiez FOOTBALL_DATA_API_KEY.",
      );
    }
    if (response.status === 429) {
      throw new Error(
        "Limite de requêtes Football-Data.org atteinte (HTTP 429). Réessayez dans une minute.",
      );
    }
    if (response.status === 403) {
      throw new Error(
        "Accès refusé par Football-Data.org (HTTP 403) : cette compétition n'est pas incluse dans le plan gratuit.",
      );
    }
    throw new Error(`Football-Data.org a répondu avec le statut ${response.status}.`);
  }

  return (await response.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* Types de l'API Football-Data.org v4 (sous-ensemble utilisé)                */
/* -------------------------------------------------------------------------- */

type ApiArea = { id: number; name: string; code?: string | null };

type ApiCompetition = {
  id: number;
  name: string;
  code: string;
  area?: ApiArea | null;
};

type ApiSeason = {
  id: number;
  startDate: string;
  endDate: string;
  currentMatchday?: number | null;
};

export type ApiTeam = {
  id: number;
  name: string;
  shortName?: string | null;
  crest?: string | null;
  area?: ApiArea | null;
};

type ApiTeamsResponse = {
  competition?: ApiCompetition | null;
  season?: ApiSeason | null;
  teams?: ApiTeam[] | null;
};

type ApiMatchTeam = {
  id: number;
  name: string;
  shortName?: string | null;
  crest?: string | null;
} | null;

type ApiMatch = {
  id: number;
  utcDate: string;
  status: string;
  venue?: string | null;
  homeTeam: ApiMatchTeam;
  awayTeam: ApiMatchTeam;
  score?: {
    fullTime?: { home: number | null; away: number | null } | null;
  } | null;
};

type ApiMatchesResponse = {
  matches?: ApiMatch[] | null;
};

/* -------------------------------------------------------------------------- */
/* Fonctions de lecture (fetch)                                               */
/* -------------------------------------------------------------------------- */

export async function fetchCompetitions(): Promise<ApiCompetition[]> {
  const data = await fetchApi<{ competitions?: ApiCompetition[] | null }>("/competitions");
  return data.competitions ?? [];
}

export async function fetchTeams(competitionCode: string): Promise<ApiTeamsResponse> {
  return fetchApi<ApiTeamsResponse>(`/competitions/${competitionCode}/teams`);
}

export async function fetchMatches(
  competitionCode: string,
  options: { dateFrom: string; dateTo: string },
): Promise<ApiMatch[]> {
  const data = await fetchApi<ApiMatchesResponse>(
    `/competitions/${competitionCode}/matches?dateFrom=${options.dateFrom}&dateTo=${options.dateTo}`,
  );
  return data.matches ?? [];
}

/* -------------------------------------------------------------------------- */
/* Helpers de mapping                                                         */
/* -------------------------------------------------------------------------- */

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Fenêtre de dates : 12 mois en arrière, 6 mois en avant. */
function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(from.getMonth() - 12);
  const to = new Date(now);
  to.setMonth(to.getMonth() + 6);
  return { dateFrom: toISODate(from), dateTo: toISODate(to) };
}

function mapMatchStatus(
  status: string | null | undefined,
): "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED" {
  switch ((status ?? "").toUpperCase()) {
    case "FINISHED":
    case "AWARDED":
      return "FINISHED";
    case "IN_PLAY":
    case "PAUSED":
    case "EXTRA_TIME":
    case "PENALTY_SHOOTOUT":
    case "LIVE":
      return "LIVE";
    case "POSTPONED":
    case "SUSPENDED":
      return "POSTPONED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return "SCHEDULED";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/* -------------------------------------------------------------------------- */
/* Synchronisation                                                            */
/* -------------------------------------------------------------------------- */

export type CompetitionSyncDetail = {
  code: string;
  name: string;
  teams: number;
  matches: number;
};

export type FootballSyncSummary = {
  competitions: number;
  teams: number;
  matches: number;
  results: CompetitionSyncDetail[];
  errors: string[];
};

/** Crée ou met à jour une compétition (upsert sur externalId). */
async function upsertCompetition(competition: ApiCompetition, season: ApiSeason | null) {
  const externalId = String(competition.id);
  const baseSlug = slugify(competition.name) || `competition-${externalId}`;
  const data = {
    name: competition.name,
    sport: "football",
    country: competition.area?.name ?? null,
    season: season?.startDate ? String(new Date(season.startDate).getFullYear()) : null,
  };

  const run = (slug: string) =>
    prisma.competition.upsert({
      where: { externalId },
      update: data,
      create: { ...data, slug, externalId },
    });

  try {
    return await run(baseSlug);
  } catch (error) {
    // Slug déjà pris par un enregistrement d'une autre API : on suffixe.
    if (isUniqueConstraintError(error)) {
      return run(`${baseSlug}-${externalId}`);
    }
    throw error;
  }
}

/** Crée ou met à jour une équipe (upsert sur externalId). */
async function upsertTeam(team: ApiTeam) {
  const externalId = String(team.id);
  const baseSlug = slugify(team.name) || `team-${externalId}`;
  const data = {
    name: team.name,
    shortName: team.shortName ?? null,
    logoUrl: team.crest ?? null,
    country: team.area?.name ?? null,
    sport: "football",
  };

  const run = (slug: string) =>
    prisma.team.upsert({
      where: { externalId },
      update: data,
      create: { ...data, slug, externalId },
    });

  try {
    return await run(baseSlug);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return run(`${baseSlug}-${externalId}`);
    }
    throw error;
  }
}

/** Synchronise une compétition : compétition + équipes + matchs. */
export async function syncCompetition(code: string): Promise<CompetitionSyncDetail> {
  // 1) Équipes (contient aussi les métadonnées de la compétition et la saison).
  const teamsResponse = await fetchTeams(code);
  const competition = teamsResponse.competition;
  if (!competition) {
    throw new Error(`Compétition « ${code} » introuvable sur Football-Data.org.`);
  }

  const season = teamsResponse.season ?? null;
  await upsertCompetition(competition, season);

  const teams = teamsResponse.teams ?? [];
  for (const team of teams) {
    await upsertTeam(team);
  }

  // 2) Matchs (passés et à venir) — limités à la SAISON EN COURS pour ne pas
  // mélanger plusieurs saisons dans le classement. On retombe sur une fenêtre
  // glissante si l'API ne fournit pas les dates de saison.
  const range =
    season?.startDate && season.endDate
      ? { dateFrom: season.startDate.slice(0, 10), dateTo: season.endDate.slice(0, 10) }
      : defaultDateRange();
  const matches = await fetchMatches(code, range);

  const competitionRecord = await prisma.competition.findUnique({
    where: { externalId: String(competition.id) },
    select: { id: true },
  });
  if (!competitionRecord) {
    throw new Error(`Compétition « ${code} » absente de la base après import.`);
  }

  let matchCount = 0;
  for (const match of matches) {
    if (!match.homeTeam?.id || !match.awayTeam?.id) {
      continue;
    }

    // Équipes inconnues (absentes de la liste des équipes) : création minimale.
    const home = await upsertTeam({
      id: match.homeTeam.id,
      name: match.homeTeam.name,
      shortName: match.homeTeam.shortName ?? null,
      crest: match.homeTeam.crest ?? null,
    });
    const away = await upsertTeam({
      id: match.awayTeam.id,
      name: match.awayTeam.name,
      shortName: match.awayTeam.shortName ?? null,
      crest: match.awayTeam.crest ?? null,
    });

    const externalId = String(match.id);
    const data = {
      competitionId: competitionRecord.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeScore: match.score?.fullTime?.home ?? null,
      awayScore: match.score?.fullTime?.away ?? null,
      status: mapMatchStatus(match.status),
      scheduledAt: new Date(match.utcDate),
      venue: match.venue ?? null,
    };

    await prisma.match.upsert({
      where: { externalId },
      update: data,
      create: { ...data, externalId },
    });
    matchCount += 1;
  }

  return { code, name: competition.name, teams: teams.length, matches: matchCount };
}

/**
 * Synchronise toutes les compétitions par défaut.
 * Une erreur sur une compétition n'interrompt pas les suivantes.
 */
export async function syncAllCompetitions(
  codes: readonly string[] = DEFAULT_COMPETITIONS,
): Promise<FootballSyncSummary> {
  const results: CompetitionSyncDetail[] = [];
  const errors: string[] = [];
  let teams = 0;
  let matches = 0;

  for (const code of codes) {
    try {
      const detail = await syncCompetition(code);
      results.push(detail);
      teams += detail.teams;
      matches += detail.matches;
    } catch (error) {
      errors.push(
        `${COMPETITION_LABELS[code] ?? code} : ${error instanceof Error ? error.message : "erreur inconnue"}`,
      );
    }
  }

  return { competitions: results.length, teams, matches, results, errors };
}
