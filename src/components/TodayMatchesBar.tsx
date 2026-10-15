import Link from "next/link";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import Image from "next/image";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LiveMinute } from "@/components/LiveMinute";
import { withStoredMatchClocks } from "@/lib/allsports-sync";
import { getFotmobStartedMatches, isFotmobLiveEnabled, normalizeFootballTeamName, sameFootballTeam } from "@/lib/fotmob-live";

const matchesForDay = unstable_cache(async (day: string, startedOnly = true) => {
  const start = new Date(`${day}T00:00:00+01:00`);
  const end = new Date(start.getTime() + 86400000);
  const matches = await prisma.match.findMany({ where: { scheduledAt: { gte: start, lt: end }, ...(startedOnly ? { status: { in: ["LIVE", "FINISHED"] as ("LIVE" | "FINISHED")[] } } : {}) }, orderBy: { scheduledAt: "asc" }, select: {
    id: true, status: true, scheduledAt: true, homeScore: true, awayScore: true,
    events: { orderBy: [{ minute: "desc" }, { extraMinute: "desc" }], take: 1, select: { minute: true, extraMinute: true, createdAt: true } },
    competition: { select: { name: true, slug: true } },
    homeTeam: { select: { name: true, shortName: true, logoUrl: true } }, awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
  } });
  return withStoredMatchClocks(matches);
}, ["home-today-started-matches"], { revalidate: 30 });

type BarTeam = { name: string; shortName: string | null; logoUrl: string | null };
type BarMatch = {
  id: string;
  href: string;
  status: string;
  scheduledAt: Date | string;
  minute: string | null;
  observedAt: string | null;
  periodEnd: number | null;
  homeScore: number | null;
  awayScore: number | null;
  competitionName: string;
  homeTeam: BarTeam;
  awayTeam: BarTeam;
};

/**
 * Matchs à afficher : la base, ou FotMob en test local (voir `fotmob-live.ts`).
 * Si FotMob ne répond pas, on retombe sur la base.
 */
async function barMatches(day: string): Promise<{ matches: BarMatch[]; fromFotmob: boolean }> {
  if (isFotmobLiveEnabled()) {
    const fotmob = await getFotmobStartedMatches(day);
    if (fotmob) {
      // Reuse stored logos; displaying the rail never calls the sports image API.
      const [teams, fixtures] = await Promise.all([
        prisma.team.findMany({ where: { sport: "football", logoUrl: { not: null } }, select: { name: true, shortName: true, logoUrl: true } }),
        matchesForDay(day, false),
      ]);
      const logoFor = (name: string) => teams.find(team => normalizeFootballTeamName(team.name) === normalizeFootballTeamName(name) || (team.shortName && normalizeFootballTeamName(team.shortName) === normalizeFootballTeamName(name)))?.logoUrl ?? null;
      return {
        fromFotmob: true,
        matches: fotmob.flatMap(match => {
          const candidates = fixtures.filter(fixture => fixture.competition.slug === match.competition.slug && sameFootballTeam(fixture.homeTeam, match.homeTeam) && sameFootballTeam(fixture.awayTeam, match.awayTeam));
          // Only link an unambiguous fixture; never substitute a standings page.
          if (candidates.length !== 1) return [];
          const fixture = candidates[0];
          return [{
          id: fixture.id,
          href: `/match/${fixture.id}`,
          status: match.status,
          scheduledAt: fixture.scheduledAt,
          minute: match.minute,
          observedAt: new Date().toISOString(),
          periodEnd: null,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          competitionName: match.competition.name,
          homeTeam: { ...match.homeTeam, logoUrl: fixture.homeTeam.logoUrl ?? logoFor(match.homeTeam.name) },
          awayTeam: { ...match.awayTeam, logoUrl: fixture.awayTeam.logoUrl ?? logoFor(match.awayTeam.name) },
        }];
        }),
      };
    }
  }
  const matches = (await matchesForDay(day)).map(match => ({
    id: match.id,
    href: `/match/${match.id}`,
    status: match.status,
    scheduledAt: match.scheduledAt,
    minute: match.minute ?? (match.events[0] ? `${match.events[0].minute}${match.events[0].extraMinute ? `+${match.events[0].extraMinute}` : ""}′` : null),
    observedAt: match.minuteObservedAt ?? (match.events[0]?.createdAt ? new Date(match.events[0].createdAt).toISOString() : null),
    periodEnd: match.minutePeriodEnd,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    competitionName: match.competition.name,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  }));
  return { matches, fromFotmob: false };
}

function teamCode(team: BarTeam): string {
  const name = team.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const codes: Record<string, string> = { 'rc lens': 'RCL', lens: 'RCL', 'sporting cp': 'SCP', sporting: 'SCP', 'manchester united': 'MUN', 'man utd': 'MUN', 'manchester city': 'MCI', 'atletico madrid': 'ATM', 'fc barcelona': 'BAR', 'fc bayern munchen': 'BAY', 'rb leipzig': 'RBL', 'sk slavia praha': 'SLP', 'real betis': 'BET', 'real madrid': 'RMA', 'paris saint-germain': 'PSG' };
  if (codes[name]) return codes[name];
  const short = team.shortName?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (short?.length === 3) return short;
  return name.replace(/^(fc|rc|sk)\s+/, '').replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase().padEnd(3, '·');
}

const upcomingFixtures = unstable_cache(async () => prisma.match.findMany({
  where: { status: "SCHEDULED", scheduledAt: { gt: new Date() } }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 240,
  select: { id: true, status: true, scheduledAt: true, homeScore: true, awayScore: true, competition: { select: { name: true, slug: true } }, homeTeam: { select: { name: true, shortName: true, logoUrl: true } }, awayTeam: { select: { name: true, shortName: true, logoUrl: true } } },
}), ["upcoming-highlight-fixtures"], { revalidate: 30 });

/** Editorial preference, not an official ranking. No provider requests. */
export function upcomingAppeal(match: BarMatch, now: number): number {
  const top = new Set(["Paris Saint-Germain", "Real Madrid", "FC Barcelona", "Liverpool FC", "Arsenal", "Manchester City", "Manchester United", "FC Bayern München", "Borussia Dortmund", "Inter", "AC Milan", "Juventus", "Atlético Madrid"].map(normalizeFootballTeamName));
  const strong = new Set(["Olympique de Marseille", "Olympique Lyonnais", "AS Monaco", "Lille", "RC Lens", "Chelsea", "Tottenham Hotspur", "Aston Villa", "SSC Napoli", "AS Roma", "Lazio", "Bayer 04 Leverkusen", "RB Leipzig", "Athletic Club", "Real Betis", "Sporting CP", "FC Porto", "Benfica"].map(normalizeFootballTeamName));
  const names = [match.homeTeam.name, match.awayTeam.name].map(normalizeFootballTeamName);
  const weights = names.map(name => top.has(name) ? 30 : strong.has(name) ? 18 : 0);
  const derby = [["Manchester United","Manchester City"],["Liverpool FC","Everton"],["Arsenal","Tottenham Hotspur"],["AC Milan","Inter"],["AS Roma","Lazio"],["Real Madrid","FC Barcelona"],["Paris Saint-Germain","Olympique de Marseille"],["Olympique Lyonnais","AS Saint-Étienne"]].some(pair => pair.map(normalizeFootballTeamName).every(name => names.includes(name)));
  const days = Math.max(0, (new Date(match.scheduledAt).getTime() - now) / 86400000);
  return weights[0] + weights[1] + Math.min(...weights) * 2 + (derby ? 50 : 0) + (/champions/i.test(match.competitionName) ? 15 : 0) - days * 5;
}

export function selectBarMatches(matches: BarMatch[], upcoming: BarMatch[], now = Date.now()) {
  const live = matches.filter(match => match.status === "LIVE");
  if (live.length) return { mode: "live" as const, visible: live.slice(0, 5), liveCount: live.length, overflow: live.length > 5 };
  const future = upcoming.filter(match => match.status === "SCHEDULED" && new Date(match.scheduledAt).getTime() > now);
  const near = future.filter(match => new Date(match.scheduledAt).getTime() <= now + 7 * 86400000);
  const selected = (near.length ? near : future).sort((a,b) => upcomingAppeal(b,now)-upcomingAppeal(a,now) || new Date(a.scheduledAt).getTime()-new Date(b.scheduledAt).getTime() || a.id.localeCompare(b.id));
  return { mode: "upcoming" as const, visible: selected.slice(0,5), liveCount: 0, overflow: false };
}

export async function TodayMatchesBar() {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const { matches } = await barMatches(day);
  const upcoming: BarMatch[] = matches.some(match => match.status === "LIVE") ? [] : (await upcomingFixtures()).map(match => ({ ...match, href: `/match/${match.id}`, competitionName: match.competition.name, minute: null, observedAt: null, periodEnd: null }));
  const selection = selectBarMatches(matches, upcoming, now.getTime());
  const { visible } = selection, hasLive = selection.mode === "live";
  if (!visible.length) return null;
  return <section aria-label={hasLive ? "Matchs en direct" : "Affiches à venir"} data-home-today className="min-w-0 py-2 text-foreground">
    <LiveRefresh intervalMs={hasLive ? 30000 : 60000} />
    <ul className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-center gap-4">
      {visible.map(match => <li key={match.id} data-live-tile="match" className="w-[180px] max-w-full shrink-0">
        <Link href={match.href} aria-label={match.homeTeam.name + ' contre ' + match.awayTeam.name} className="relative grid h-[84px] grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md border border-border bg-muted px-3 pb-4 pt-2 text-sm hover:bg-background/50 focus-visible:outline-2">
          {[match.homeTeam,match.awayTeam].map((team,index)=><span key={index} className={'row-start-1 flex flex-col items-center gap-1 '+(index?'col-start-3':'col-start-1')} title={team.name}>{team.logoUrl ? <Image src={team.logoUrl} alt="" width={28} height={28} className="h-7 w-7 object-contain"/> : <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[9px] font-bold">{teamCode(team)}</span>}<span className="text-xs font-medium uppercase">{teamCode(team)}</span></span>)}
          <span className={`col-start-2 row-start-1 inline-flex items-center justify-center rounded px-2 py-2 text-xs tabular-nums ${match.status === 'LIVE' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200' : 'bg-background'}`}>{hasLive ? <><span className="font-bold">{match.homeScore ?? '–'}</span><span aria-hidden="true" className="mx-2 h-4 border-l border-current opacity-40"/><span className="font-bold">{match.awayScore ?? '–'}</span></> : <time dateTime={new Date(match.scheduledAt).toISOString()}>{new Date(match.scheduledAt).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Africa/Lagos"})}</time>}</span>
          <span className={`absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[11px] font-bold leading-tight ${hasLive ? 'bg-red-600 text-white' : 'bg-background text-muted-foreground'}`}>{match.status === 'LIVE' ? <LiveMinute minute={match.minute} observedAt={match.observedAt} periodEnd={match.periodEnd}/> : new Date(match.scheduledAt).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",timeZone:"Africa/Lagos"})}</span>
        </Link>
      </li>)}
      {selection.overflow && <li data-live-tile="button" className="w-[180px] max-w-full shrink-0"><Link href="/live" className="flex h-[84px] flex-col justify-center gap-2 rounded-md border border-border bg-muted px-4 text-sm font-semibold hover:bg-background/50 focus-visible:outline-2"><span className="w-fit rounded bg-sky-100 px-1.5 text-xs font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">{selection.liveCount}</span><span>Voir les lives</span></Link></li>}
    </ul>
  </section>;
}
