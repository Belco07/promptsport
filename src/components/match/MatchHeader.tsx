import { ClubForm } from "@/components/club/ClubPulse";
import type { ClubPulseData } from "@/lib/club-digest";
import Image from "next/image";
import Link from "next/link";
import { MATCH_STATUS_LABELS, MATCH_STATUS_TONES, type MatchCardData } from "@/components/MatchCard";
import { Badge } from "@/components/ui/Badge";
import { MatchLocalTime } from "./MatchLocalTime";
import type { MatchEvent, MatchLineup } from "@/generated/prisma/client";
import { playerProfileKey } from "@/lib/slug";
import { LiveMinute } from "@/components/LiveMinute";

export function MatchHeader({ match: m, playerLinks = {}, teamForms = {} }: { teamForms?: Record<string, ClubPulseData["form"]>; playerLinks?: Record<string, string>; match: MatchCardData & { venue: string | null; homeTeamId: string; awayTeamId: string; events: MatchEvent[]; lineups: MatchLineup[]; competition: { name: string; slug: string } } }) {
  const playerName = (teamId: string, name: string) => { const href = playerLinks[playerProfileKey(teamId, name)]; return href ? <Link href={href} className="hover:underline focus-visible:outline-2">{name}</Link> : name; };
  const remaining = Math.max(0, m.scheduledAt.getTime() - Date.now());
  const countdown = remaining >= 86400000 ? 'J-' + Math.ceil(remaining / 86400000) : remaining >= 3600000 ? 'H-' + Math.ceil(remaining / 3600000) : remaining > 0 ? 'Dans ' + Math.ceil(remaining / 60000) + ' min' : 'Coup d’envoi attendu';
  const winner = m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null && m.homeScore !== m.awayScore ? (m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId) : null;
  const score = (m.status === "LIVE" || m.status === "FINISHED") && m.homeScore !== null && m.awayScore !== null ? <><span>{m.homeScore}</span><span className="mx-1 font-light md:mx-3">–</span><span>{m.awayScore}</span></> : 'vs';
  return <header className="relative overflow-hidden border-y border-border bg-card px-3 py-8 text-center md:px-10 md:py-12">
    <style>{`@keyframes match-score-pulse { 0%,100% { box-shadow: 0 0 0 0 hsl(var(--accent) / 0); } 50% { box-shadow: 0 0 0 8px hsl(var(--accent) / .18); } } @media (prefers-reduced-motion: no-preference) { .animate-pulse-lime { animation: match-score-pulse 2s ease-in-out infinite; } }`}</style>
    <Link href={'/competition/' + m.competition.slug} className="text-xs font-bold uppercase tracking-widest text-editorial-link">{m.competition.name}</Link>
    <h1 style={{ letterSpacing: "normal", lineHeight: 1.6, fontWeight: 600, textTransform: "none" }} className="mx-auto mt-4 max-w-2xl text-balance break-words font-sans text-base text-muted-foreground md:text-lg">{m.homeTeam.name} <span className="font-normal">contre</span> {m.awayTeam.name}</h1>
    <div className="mt-4 flex items-center justify-center gap-2"><Badge tone={MATCH_STATUS_TONES[m.status]} variant="status" pulse={m.status === 'LIVE'}>{MATCH_STATUS_LABELS[m.status]}</Badge>{m.status==='LIVE'&&<span className="rounded-md bg-status-danger px-2 py-1 text-xs font-bold text-white"><LiveMinute minute={m.minute??null} observedAt={m.minuteObservedAt} periodEnd={m.minutePeriodEnd}/></span>}</div>
    <div className="my-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 md:gap-8">
      {[m.homeTeam, m.awayTeam].map((team, index) => {
        const teamId = index ? m.awayTeamId : m.homeTeamId;
        const events = m.events.filter(event => event.teamId === teamId);
        const goals = events.filter(event => event.type === 'GOAL'), cards = events.filter(event => event.type === 'YELLOW_CARD' || event.type === 'RED_CARD');
        const missedPenalties=events.filter(event=>event.type==='MISSED_PENALTY');
        const teamScore=index?m.awayScore:m.homeScore;
        return <div key={index} className={index ? 'col-start-3 row-start-1' : 'col-start-1 row-start-1'}>
          {team.logoUrl ? <Image src={team.logoUrl} alt="" width={80} height={80} sizes="80px" className="mx-auto h-14 w-14 object-contain md:h-20 md:w-20"/> : <span className="text-4xl font-black text-muted-foreground">{team.name[0]}</span>}
          <p className="mt-3 min-w-0 truncate text-sm font-bold text-foreground md:text-xl">{team.slug ? <Link href={`/club/${team.slug}`} title={team.name} className="block truncate hover:underline focus-visible:outline-2">{team.shortName || team.name}</Link> : team.name}</p>
          {winner === teamId && <p className="mt-2 text-xs font-bold uppercase tracking-widest text-editorial-link">Victoire</p>}
          {m.status === "SCHEDULED" && <p className="mt-2 text-xs text-muted-foreground">{m.lineups.find(row => row.teamId === teamId)?.formation ? 'Formation annoncée : ' + m.lineups.find(row => row.teamId === teamId)?.formation : 'Composition pas encore communiquée'}</p>}

          {!!goals.length && <ul aria-label={'Buteurs de ' + team.name} className="mt-3 space-y-1 text-xs text-muted-foreground">{goals.map(event => <li key={event.id}>⚽ {playerName(teamId, event.playerName)} <span className="whitespace-nowrap tabular-nums">{event.minute}{event.extraMinute ? '+' + event.extraMinute : ''}′</span></li>)}</ul>}
          {(teamScore??0)>goals.length&&<p className="mt-2 text-xs text-muted-foreground">Buteur en attente de mise à jour.</p>}
          {!!missedPenalties.length&&<ul aria-label={'Penalties manqués de '+team.name} className="mt-2 space-y-1 text-xs text-status-danger">{missedPenalties.map(event=><li key={event.id}>× Penalty manqué · {playerName(teamId, event.playerName)} {event.minute}{event.extraMinute?'+'+event.extraMinute:''}′</li>)}</ul>}
          {!!cards.length && <ul aria-label={'Cartons de ' + team.name} className="mt-2 space-y-1 text-xs text-muted-foreground">{cards.map(event => <li key={event.id} className="flex items-center justify-center gap-1.5"><span aria-hidden="true" className={'inline-block h-3 w-2 shrink-0 rounded-sm ' + (event.type === 'RED_CARD' ? 'bg-status-danger' : 'bg-yellow-400')}/><span className="sr-only">{event.type === 'RED_CARD' ? 'Carton rouge ' : 'Carton jaune '}</span><span>{playerName(teamId, event.playerName)} {event.minute}{event.extraMinute ? '+' + event.extraMinute : ''}′</span></li>)}</ul>}
        </div>;
      })}
      <div className="col-start-2 row-start-1 mt-4 md:mt-6">
        {m.status === "SCHEDULED" ? <><p className="text-3xl font-black tabular-nums text-foreground md:text-6xl"><MatchLocalTime date={m.scheduledAt.toISOString()} timeOnly/></p><p className="mt-3 text-xs font-bold text-editorial-link md:text-sm">{countdown}</p></> : <><p className={"whitespace-nowrap rounded-xl px-2 text-5xl font-black tabular-nums text-foreground md:px-5 md:text-8xl " + (m.status === "LIVE" ? "animate-pulse-lime motion-reduce:animate-none bg-accent/10" : "")}>{score}</p>{m.status === "FINISHED" && <p className="mt-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Score final</p>}</>}
      </div>
    </div>
    {m.status === "SCHEDULED" && <div className="mb-6 grid grid-cols-2 gap-4">{[m.homeTeamId, m.awayTeamId].map((teamId, index) => <div key={teamId} className="min-w-0" aria-label={'Forme de ' + (index ? m.awayTeam.name : m.homeTeam.name)}><p className="mb-2 text-xs text-muted-foreground">Forme récente</p><ClubForm form={teamForms[teamId] ?? []} centered compact/></div>)}</div>}
    <p className="text-sm text-muted-foreground"><MatchLocalTime date={m.scheduledAt.toISOString()}/></p>
    {m.status === "FINISHED" && <p className="mt-5"><Link href={'/match/' + m.id + '?tab=resume#resume'} className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-sm font-bold text-accent-foreground">Voir le résumé ↓</Link></p>}
    <p className="mt-2 text-xs text-muted-foreground">{m.venue ?? 'Lieu non communiqué'}</p>
  </header>;
}
