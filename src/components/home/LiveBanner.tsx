import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LiveMinute } from "@/components/LiveMinute";
import { withStoredMatchClocks } from "@/lib/allsports-sync";

const getDayMatches = unstable_cache(async (day: string) => {
  const start = new Date(`${day}T00:00:00+01:00`), end = new Date(start.getTime() + 86_400_000);
  const matches = await prisma.match.findMany({ where: { OR: [{ status: "LIVE" }, { scheduledAt: { gte: start, lt: end }, status: { in: ["SCHEDULED", "FINISHED"] } }] }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], select: { id: true, status: true, scheduledAt: true, homeScore: true, awayScore: true, homeTeam: { select: { name: true, shortName: true, logoUrl: true } }, awayTeam: { select: { name: true, shortName: true, logoUrl: true } } } });
  return withStoredMatchClocks(matches);
}, ["home-edition-day-matches-wp32"], { revalidate: 30 });

/** Initiales d'une équipe sans logo (pastille de repli, même encombrement qu'un logo). */
function teamInitials(team: { name: string; shortName: string | null }): string {
  const source = (team.shortName ?? team.name).normalize("NFD").replace(/[̀-ͯ]/g, "");
  const words = source.split(/[\s.-]+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 3).map(word => word[0]).join("") : source.slice(0, 3)).toUpperCase();
}

export async function LiveBanner() {
  const day = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Lagos" }).format(new Date());
  const matches = await getDayMatches(day);
  if (!matches.length) return null;
  const live = matches.filter(match => match.status === "LIVE");
  const selected = (live.length ? live : matches).slice(0, 5);
  return <section data-home-today aria-label={live.length ? "Matchs en direct" : "Matchs du jour"} className="order-2 min-w-0 animate-fade-up rounded-[18px] border border-border bg-muted px-4 py-4 text-foreground lg:order-1 lg:col-span-4">
    <LiveRefresh intervalMs={live.length ? 30_000 : 60_000} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-foreground">{live.length ? <><span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />Le sport en direct</> : "Aujourd’hui sur les terrains"}</h2><Link href={live.length ? "/live" : "/scores"} className="text-xs font-semibold text-editorial-link underline-offset-4 hover:underline">{live.length ? "Tous les lives" : "Tous les scores"} →</Link></div>
    <ul className={`flex snap-x flex-nowrap gap-3 overflow-x-auto pt-3 ${selected.length === 1 ? "justify-center" : "justify-start lg:justify-center"}`}>
      {selected.map(match => <li key={match.id} className="w-[180px] min-w-[170px] shrink-0 snap-start"><Link href={`/match/${match.id}`} className="flex h-[96px] flex-col justify-between rounded-[13px] border border-border bg-card px-3 py-3 dark:bg-background text-foreground shadow-[0_4px_20px_rgb(0_0_0/7%)] transition-shadow hover:shadow-[0_6px_28px_rgb(0_0_0/12%)] motion-reduce:transition-none">
        <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">{[match.homeTeam, match.awayTeam].map((team, index) => <span key={index} className={`flex min-w-0 flex-col items-center gap-1 ${index ? "col-start-3 row-start-1" : "col-start-1 row-start-1"}`} title={team.name}>{team.logoUrl ? <Image src={team.logoUrl} alt="" width={24} height={24} className="h-6 w-6 object-contain" /> : <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[8px] font-black uppercase text-muted-foreground">{teamInitials(team)}</span>}<span className="max-w-full truncate text-[11px] font-semibold">{team.shortName ?? team.name}</span></span>)}
          <span className="col-start-2 row-start-1 whitespace-nowrap text-sm tabular-nums">{match.status === "SCHEDULED" ? <time dateTime={new Date(match.scheduledAt).toISOString()}>{new Date(match.scheduledAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</time> : <><strong>{match.homeScore ?? "—"}</strong><span className="px-2 font-normal opacity-60">|</span><strong>{match.awayScore ?? "—"}</strong></>}</span>
        </span><span className="mt-2 flex justify-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{match.status === "LIVE" ? <span className="rounded-full bg-status-danger px-2 py-0.5 text-white"><LiveMinute minute={match.minute ?? null} observedAt={match.minuteObservedAt ?? null} periodEnd={match.minutePeriodEnd ?? null} /></span> : match.status === "FINISHED" ? "Terminé" : "À venir"}</span>
      </Link></li>)}
    </ul>
  </section>;
}
