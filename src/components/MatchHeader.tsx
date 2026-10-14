import Image from "next/image";
import Link from "next/link";
import { MATCH_STATUS_LABELS, MATCH_STATUS_TONES, type MatchCardData } from "@/components/MatchCard";
import { Badge } from "@/components/ui/Badge";
import { formatMatchDate } from "@/lib/formatDate";
import type { MatchEvent } from "@/generated/prisma/client";
import { playerProfileKey } from "@/lib/slug";
import { LiveMinute } from "@/components/LiveMinute";

export function MatchHeader({ match: m, playerLinks = {} }: { playerLinks?: Record<string, string>; match: MatchCardData & { venue: string | null; homeTeamId: string; awayTeamId: string; events: MatchEvent[]; competition: { name: string; slug: string } } }) {
  const playerName = (teamId: string, name: string) => { const href = playerLinks[playerProfileKey(teamId, name)]; return href ? <Link href={href} className="hover:underline focus-visible:outline-2">{name}</Link> : name; };
  const score = (m.status === "LIVE" || m.status === "FINISHED") && m.homeScore !== null && m.awayScore !== null ? m.homeScore + ' – ' + m.awayScore : 'vs';
  return <header className="border-y border-border bg-card px-3 py-7 text-center md:p-8">
    <Link href={'/competition/' + m.competition.slug} className="text-xs font-bold uppercase tracking-widest text-editorial-link">{m.competition.name}</Link>
    <h1 className="sr-only">{m.homeTeam.name} contre {m.awayTeam.name}</h1>
    <div className="mt-4 flex items-center justify-center gap-2"><Badge tone={MATCH_STATUS_TONES[m.status]} variant="status" pulse={m.status === 'LIVE'}>{MATCH_STATUS_LABELS[m.status]}</Badge>{m.status==='LIVE'&&<span className="rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white"><LiveMinute minute={m.minute??null} observedAt={m.minuteObservedAt} periodEnd={m.minutePeriodEnd}/></span>}</div>
    <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-start gap-2 md:gap-8">
      {[m.homeTeam, m.awayTeam].map((team, index) => {
        const teamId = index ? m.awayTeamId : m.homeTeamId;
        const events = m.events.filter(event => event.teamId === teamId);
        const goals = events.filter(event => event.type === 'GOAL'), cards = events.filter(event => event.type === 'YELLOW_CARD' || event.type === 'RED_CARD');
        const missedPenalties=events.filter(event=>event.type==='MISSED_PENALTY');
        const teamScore=index?m.awayScore:m.homeScore;
        return <div key={index} className={index ? 'col-start-3 row-start-1' : 'col-start-1 row-start-1'}>
          {team.logoUrl ? <Image src={team.logoUrl} alt="" width={80} height={80} sizes="80px" className="mx-auto h-14 w-14 object-contain md:h-20 md:w-20"/> : <span className="text-4xl font-black text-muted-foreground">{team.name[0]}</span>}
          <p className="mt-3 break-words text-sm font-bold text-foreground md:text-xl">{team.slug ? <Link href={`/club/${team.slug}`} className="hover:underline focus-visible:outline-2">{team.name}</Link> : team.name}</p>
          {!!goals.length && <ul aria-label={'Buteurs de ' + team.name} className="mt-3 space-y-1 text-xs text-muted-foreground">{goals.map(event => <li key={event.id}>⚽ {playerName(teamId, event.playerName)} <span className="whitespace-nowrap tabular-nums">{event.minute}{event.extraMinute ? '+' + event.extraMinute : ''}′</span></li>)}</ul>}
          {(teamScore??0)>goals.length&&<p className="mt-2 text-xs text-muted-foreground">Buteur en attente de mise à jour.</p>}
          {!!missedPenalties.length&&<ul aria-label={'Penalties manqués de '+team.name} className="mt-2 space-y-1 text-xs text-status-danger">{missedPenalties.map(event=><li key={event.id}>× Penalty manqué · {playerName(teamId, event.playerName)} {event.minute}{event.extraMinute?'+'+event.extraMinute:''}′</li>)}</ul>}
          {!!cards.length && <ul aria-label={'Cartons de ' + team.name} className="mt-2 space-y-1 text-xs text-muted-foreground">{cards.map(event => <li key={event.id} className="flex items-center justify-center gap-1.5"><span aria-label={event.type === 'RED_CARD' ? 'Carton rouge' : 'Carton jaune'} className={'inline-block h-3 w-2 shrink-0 rounded-sm ' + (event.type === 'RED_CARD' ? 'bg-red-600' : 'bg-yellow-400')}/><span>{playerName(teamId, event.playerName)} {event.minute}{event.extraMinute ? '+' + event.extraMinute : ''}′</span></li>)}</ul>}
        </div>;
      })}
      <p className="col-start-2 row-start-1 mt-5 whitespace-nowrap text-4xl font-black tabular-nums text-foreground md:mt-8 md:text-6xl">{score}</p>
    </div>
    <time className="text-sm text-muted-foreground" dateTime={m.scheduledAt.toISOString()}>{formatMatchDate(m.scheduledAt)}</time>
    <p className="mt-2 text-xs text-muted-foreground">{m.venue ?? 'Lieu non communiqué'}</p>
  </header>;
}
