import Link from "next/link";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import Image from "next/image";
import { LiveRefresh } from "@/components/LiveRefresh";
import { ScoresScroller } from "@/components/ScoresScroller";
import { getFotmobStartedMatches, isFotmobLiveEnabled } from "@/lib/fotmob-live";

const matchesForDay = unstable_cache(async (day: string) => {
  const start = new Date(`${day}T00:00:00+01:00`);
  const end = new Date(start.getTime() + 86400000);
  return prisma.match.findMany({ where: { scheduledAt: { gte: start, lt: end }, status: { in: ["LIVE", "FINISHED"] } }, orderBy: { scheduledAt: "asc" }, select: {
    id: true, status: true, scheduledAt: true, homeScore: true, awayScore: true,
    competition: { select: { name: true } },
    homeTeam: { select: { name: true, shortName: true, logoUrl: true } }, awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
  } });
}, ["home-today-started-matches"], { revalidate: 30 });

type BarTeam = { name: string; shortName: string | null; logoUrl: string | null };
type BarMatch = {
  id: string;
  href: string;
  status: string;
  minute: string | null;
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
      return {
        fromFotmob: true,
        matches: fotmob.map(match => ({
          id: match.id,
          // Pas de match correspondant en base : on renvoie vers la compétition.
          href: `/competition/${match.competition.slug}`,
          status: match.status,
          minute: match.minute,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          competitionName: match.competition.name,
          homeTeam: { ...match.homeTeam, logoUrl: null },
          awayTeam: { ...match.awayTeam, logoUrl: null },
        })),
      };
    }
  }
  const matches = (await matchesForDay(day)).map(match => ({
    id: match.id,
    href: `/match/${match.id}`,
    status: match.status,
    minute: null,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    competitionName: match.competition.name,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  }));
  return { matches, fromFotmob: false };
}

export async function TodayMatchesBar() {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const { matches, fromFotmob } = await barMatches(day);
  const hasLive = matches.some(match => match.status === "LIVE");
  return <section aria-label="Matchs du jour commencés" data-home-today className="flex h-[60px] min-w-0 border-y border-border bg-muted text-foreground">
    {fromFotmob && hasLive && <LiveRefresh />}
    {matches.length ? <ScoresScroller autoScroll>{matches.map(match => <li key={match.id} className="h-[58px] w-[290px] shrink-0 border-r border-border sm:w-[350px]">
      <Link href={match.href} className="flex h-full flex-col justify-center gap-1 px-3 hover:bg-background/50">
        <span className="flex justify-between gap-2 text-[9px] uppercase tracking-wide text-muted-foreground"><span className="truncate">{match.competitionName}</span><span className={match.status === "LIVE" ? "shrink-0 font-bold text-status-error-foreground" : "shrink-0"}>{match.status === "LIVE" ? `En direct${match.minute ? ` · ${match.minute}` : ""}` : "Terminé"}</span></span>
        <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-xs">
          <span className="flex min-w-0 items-center justify-end gap-1.5"><span className="truncate">{match.homeTeam.shortName ?? match.homeTeam.name}</span>{match.homeTeam.logoUrl && <Image src={match.homeTeam.logoUrl} alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" />}</span>
          <span className="font-bold tabular-nums">{match.homeScore ?? "–"} – {match.awayScore ?? "–"}</span>
          <span className="flex min-w-0 items-center gap-1.5">{match.awayTeam.logoUrl && <Image src={match.awayTeam.logoUrl} alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 object-contain" />}<span className="truncate">{match.awayTeam.shortName ?? match.awayTeam.name}</span></span>
        </span>
      </Link>
    </li>)}</ScoresScroller> : <p className="flex w-full items-center justify-center gap-2 px-3 text-xs text-muted-foreground">Aucun match commencé aujourd’hui. <Link href="/scores" className="font-semibold text-editorial-link hover:underline">Calendrier →</Link></p>}
  </section>;
}
