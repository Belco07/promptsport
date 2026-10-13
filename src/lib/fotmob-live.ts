/**
 * Scores en direct FotMob — TEST LOCAL UNIQUEMENT.
 *
 * FotMob n'a pas d'API publique : `/api/data/matches` est l'endpoint
 * non documenté de son propre site. Il peut changer ou être bloqué sans
 * préavis, et son usage n'est pas autorisé pour un site en production. Cette
 * source sert donc seulement à voir le bandeau vivre en développement, en
 * attendant un fournisseur officiel (API-Football payant, football-data.org…).
 *
 * Double verrou : `FOTMOB_LIVE=1` dans `.env` **et** un serveur hors
 * production (`next dev`). Un build de production ignore la variable.
 *
 * Aucune écriture en base : les matchs FotMob n'ont pas d'identifiant interne,
 * le bandeau renvoie donc vers la page de la compétition plutôt que du match.
 */

const ENDPOINT = "https://www.fotmob.com/api/data/matches";

export function normalizeFootballTeamName(name: string): string {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b(club|de|fc|rc|sk|cf|cp)\b/g, "").replace(/prague/g, "praha").replace(/[^a-z0-9]/g, "");
  return ({ manutd: "manchesterunited", psg: "parissaintgermain", atleti: "atleticomadrid" } as Record<string,string>)[normalized] ?? normalized;
}
export function sameFootballTeam(left: {name:string;shortName:string|null}, right:{name:string;shortName:string|null}) {
  const names = [left.name,left.shortName].filter((name):name is string=>Boolean(name)).map(normalizeFootballTeamName);
  return [right.name,right.shortName].some(name=>name&&names.includes(normalizeFootballTeamName(name)));
}

/** Read-only local preview: the rail, scores and fixture use the same snapshot. */
export async function withLocalFootballLive<T extends { status:string;homeScore:number|null;awayScore:number|null;scheduledAt:Date;homeTeam:{name:string;shortName:string|null};awayTeam:{name:string;shortName:string|null};competition:{slug:string}|null;minute?:string|null;minuteObservedAt?:string|null }>(matches:T[]) {
  const fallback=matches.map(match=>({...match,minute:match.minute??null,minuteObservedAt:match.minuteObservedAt??null}));
  if (!isFotmobLiveEnabled() || !matches.length) return fallback;
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const snapshots=await getFotmobStartedMatches(day);
  if (!snapshots) return fallback;
  return fallback.map(match=>{
    const matchDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(match.scheduledAt);
    if (matchDay!==day) return match;
    const candidates=snapshots.filter(snapshot=>snapshot.competition.slug===match.competition?.slug&&sameFootballTeam(snapshot.homeTeam,match.homeTeam)&&sameFootballTeam(snapshot.awayTeam,match.awayTeam));
    if (candidates.length!==1) return match;
    const snapshot=candidates[0];
    return {...match,status:snapshot.status,homeScore:snapshot.homeScore,awayScore:snapshot.awayScore,minute:snapshot.minute,minuteObservedAt:new Date().toISOString()};
  });
}

/** Compétitions suivies : identifiant FotMob → libellé et slug de la page compétition. */
const LEAGUES: Record<number, { name: string; slug: string }> = {
  53: { name: "Ligue 1", slug: "ligue-1" },
  47: { name: "Premier League", slug: "premier-league" },
  87: { name: "La Liga", slug: "liga" },
  55: { name: "Serie A", slug: "serie-a" },
  54: { name: "Bundesliga", slug: "bundesliga" },
  42: { name: "Champions League", slug: "uefa-champions-league" },
};

type FotmobTeam = { id: number; name: string; shortName?: string; score?: number | null };
type FotmobMatch = {
  id: number;
  home: FotmobTeam;
  away: FotmobTeam;
  status?: {
    utcTime?: string;
    started?: boolean;
    finished?: boolean;
    cancelled?: boolean;
    liveTime?: { short?: string };
  };
};
type FotmobResponse = { leagues?: { primaryId: number; matches: FotmobMatch[] }[] };

export type FotmobLiveMatch = {
  id: string;
  status: "LIVE" | "FINISHED";
  /** Minute de jeu affichée par FotMob (« 67' », « MT »…), pour les matchs en cours. */
  minute: string | null;
  scheduledAt: Date;
  homeScore: number | null;
  awayScore: number | null;
  competition: { name: string; slug: string };
  homeTeam: { name: string; shortName: string | null };
  awayTeam: { name: string; shortName: string | null };
};

export function isFotmobLiveEnabled(): boolean {
  return process.env.FOTMOB_LIVE === "1" && process.env.NODE_ENV !== "production";
}

/**
 * Matchs commencés du jour (`day` au format AAAA-MM-JJ) dans les compétitions
 * suivies. Réponse mise en cache 30 s : un seul appel FotMob par demi-minute,
 * quel que soit le nombre de visiteurs. En cas d'échec, renvoie `null` et
 * l'appelant retombe sur la base.
 */
export async function getFotmobStartedMatches(day: string): Promise<FotmobLiveMatch[] | null> {
  const url = `${ENDPOINT}?date=${day.replaceAll("-", "")}&timezone=Africa/Lagos`;
  let data: FotmobResponse;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (PromptSport dev)" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 30 },
    });
    if (!response.ok) {
      console.warn(`[fotmob] HTTP ${response.status} — repli sur la base`);
      return null;
    }
    data = (await response.json()) as FotmobResponse;
  } catch (error) {
    console.warn("[fotmob] requête impossible — repli sur la base", error);
    return null;
  }

  const matches: FotmobLiveMatch[] = [];
  for (const league of data.leagues ?? []) {
    const competition = LEAGUES[league.primaryId];
    if (!competition) continue;
    for (const match of league.matches) {
      const status = match.status ?? {};
      if (!status.started || status.cancelled) continue;
      const live = !status.finished;
      matches.push({
        id: `fotmob-${match.id}`,
        status: live ? "LIVE" : "FINISHED",
        // FotMob encadre la minute de marques de direction Unicode invisibles.
        minute: live ? status.liveTime?.short?.replace(/[‎‏]/g, "") ?? null : null,
        scheduledAt: new Date(status.utcTime ?? Date.now()),
        homeScore: match.home.score ?? null,
        awayScore: match.away.score ?? null,
        competition,
        homeTeam: { name: match.home.name, shortName: match.home.shortName ?? null },
        awayTeam: { name: match.away.name, shortName: match.away.shortName ?? null },
      });
    }
  }
  return matches.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
