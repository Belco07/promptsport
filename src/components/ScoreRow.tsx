import Image from "next/image";
import Link from "next/link";
import { MATCH_STATUS_LABELS, type MatchCardData } from "./MatchCard";
import { LiveMinute } from "./LiveMinute";
export function ScoreRow({match}:{match:MatchCardData}) {
  const scored=match.status==="LIVE"||match.status==="FINISHED";
  const logo=(team:MatchCardData["homeTeam"])=>team.logoUrl?<Image src={team.logoUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain"/>:<span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-xs">{team.name[0]}</span>;
  return <Link href={`/match/${match.id}`} className="relative grid min-h-[64px] grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-sm hover:bg-background/50 focus-visible:outline-2 sm:gap-4 sm:px-[15%]">
    <span className={`absolute left-4 hidden text-xs sm:block ${match.status === "LIVE" ? "font-semibold text-status-danger" : "text-muted-foreground"}`}>{match.status === "LIVE" ? <LiveMinute minute={match.minute ?? null} observedAt={match.minuteObservedAt} periodEnd={match.minutePeriodEnd}/> : MATCH_STATUS_LABELS[match.status]}</span>
    <span className="flex min-w-0 items-center justify-end gap-2 sm:gap-3"><span className="text-right font-semibold leading-tight">{match.homeTeam.shortName||match.homeTeam.name}</span>{logo(match.homeTeam)}</span>
    <span className={`rounded px-2 py-2 text-center font-semibold tabular-nums ${match.status === "LIVE" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" : "bg-background"}`}>{scored?<span className="inline-flex items-center justify-center"><span>{match.homeScore??"–"}</span><span aria-hidden="true" className="mx-2 h-4 border-l border-current opacity-40"/><span>{match.awayScore??"–"}</span></span>:<time dateTime={match.scheduledAt.toISOString()}>{match.scheduledAt.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Africa/Lagos"})}</time>}<span className="sr-only sm:hidden">{MATCH_STATUS_LABELS[match.status]}</span></span>
    <span className="flex min-w-0 items-center gap-2 sm:gap-3">{logo(match.awayTeam)}<span className="font-semibold leading-tight">{match.awayTeam.shortName||match.awayTeam.name}</span></span>
  </Link>;
}
