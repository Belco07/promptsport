import Image from "next/image";
import Link from "next/link";
import { MATCH_STATUS_LABELS, type MatchCardData } from "./MatchCard";
export function ScoreRow({match}:{match:MatchCardData}) {
  const scored=match.status==="LIVE"||match.status==="FINISHED";
  const logo=(team:MatchCardData["homeTeam"])=>team.logoUrl?<Image src={team.logoUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain"/>:<span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-xs">{team.name[0]}</span>;
  return <Link href={`/match/${match.id}`} className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-sm hover:bg-background/50 focus-visible:outline-2 sm:gap-4 sm:px-6">
    <span className="flex min-w-0 items-center justify-end gap-2 sm:gap-3"><span className="text-right font-semibold leading-tight">{match.homeTeam.shortName||match.homeTeam.name}</span>{logo(match.homeTeam)}</span>
    <span className="text-center"><span className={`block font-bold tabular-nums ${match.status==="LIVE"?"text-status-error-foreground":""}`}>{scored?`${match.homeScore??"–"} – ${match.awayScore??"–"}`:<time dateTime={match.scheduledAt.toISOString()}>{match.scheduledAt.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Africa/Lagos"})}</time>}</span><span className="block text-[9px] uppercase text-muted-foreground">{MATCH_STATUS_LABELS[match.status]}</span></span>
    <span className="flex min-w-0 items-center gap-2 sm:gap-3">{logo(match.awayTeam)}<span className="font-semibold leading-tight">{match.awayTeam.shortName||match.awayTeam.name}</span></span>
  </Link>;
}
