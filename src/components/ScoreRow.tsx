import Image from "next/image";
import Link from "next/link";
import { MATCH_STATUS_LABELS, type MatchCardData } from "./MatchCard";
import { LiveMinute } from "./LiveMinute";
import { LiveBadge } from "./LiveBadge";
export function ScoreRow({match}:{match:MatchCardData}) {
  const scored=match.status==="LIVE"||match.status==="FINISHED";
  const hasScore=match.homeScore!==null&&match.awayScore!==null;
  const pending=match.status==="SCHEDULED"&&match.scheduledAt<=new Date();
  const future=match.status==="SCHEDULED"&&!pending;
  const logo=(team:MatchCardData["homeTeam"])=>team.logoUrl?<Image src={team.logoUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain"/>:<span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-xs">{team.name[0]}</span>;
  const clubLogo=(team:MatchCardData["homeTeam"])=>team.slug?<Link href={`/club/${team.slug}`} aria-label={`Club ${team.name}`} className="shrink-0 rounded focus-visible:outline-2">{logo(team)}</Link>:logo(team);
  return <div className="relative grid min-h-[64px] grid-cols-[minmax(0,1fr)_76px_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-sm hover:bg-background/50 sm:gap-4 sm:px-[15%]">
    <span className={`absolute left-4 hidden max-w-24 text-xs leading-tight sm:block ${match.status === "LIVE" ? "font-semibold text-status-danger" : "text-muted-foreground"}`}>{match.status === "LIVE" ? <span className="flex flex-col gap-1"><LiveBadge/><LiveMinute minute={match.minute ?? null} observedAt={match.minuteObservedAt} periodEnd={match.minutePeriodEnd}/></span> : pending ? "Résultat en attente" : MATCH_STATUS_LABELS[match.status]}</span>
    <span className="flex min-w-0 items-center justify-end gap-2 sm:gap-3"><Link href={`/match/${match.id}`} className="text-right font-semibold leading-tight hover:underline">{match.homeTeam.shortName||match.homeTeam.name}</Link>{clubLogo(match.homeTeam)}</span>
    <Link href={`/match/${match.id}`} aria-label={`Fiche du match ${match.homeTeam.name} contre ${match.awayTeam.name}${scored&&hasScore?` : ${match.homeScore} à ${match.awayScore}`:""}`} className={`rounded px-2 py-2 text-center font-semibold tabular-nums focus-visible:outline-2 ${match.status === "LIVE" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" : "bg-background"}`}>{scored&&hasScore?<span className="inline-flex items-center justify-center"><span className="font-bold">{match.homeScore}</span><span aria-hidden="true" className="mx-2 h-4 border-l border-current opacity-40"/><span className="font-bold">{match.awayScore}</span></span>:future?<time dateTime={match.scheduledAt.toISOString()}>{match.scheduledAt.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:"Africa/Lagos"})}</time>:<span title={pending?"Résultat en attente de synchronisation":"Score indisponible"}>—</span>}{match.status==="LIVE"?<span className="mt-1 block sm:hidden"><LiveBadge/></span>:<span className="sr-only sm:hidden">{pending?"Résultat en attente":MATCH_STATUS_LABELS[match.status]}</span>}</Link>
    <span className="flex min-w-0 items-center gap-2 sm:gap-3">{clubLogo(match.awayTeam)}<Link href={`/match/${match.id}`} className="font-semibold leading-tight hover:underline">{match.awayTeam.shortName||match.awayTeam.name}</Link></span>
  </div>;
}
