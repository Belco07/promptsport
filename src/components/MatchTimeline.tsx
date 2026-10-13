import { ArrowRightLeft, CircleDot } from "lucide-react";
import type { MatchEvent } from "@/generated/prisma/client";

const labels = { GOAL: "But", YELLOW_CARD: "Carton jaune", RED_CARD: "Carton rouge", SUBSTITUTION: "Remplacement" };
export function MatchTimeline({ events, homeTeamId, homeName, awayName }: { events: MatchEvent[]; homeTeamId: string; homeName: string; awayName: string }) {
  if (!events.length) return <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">Disponible prochainement — aucun événement à afficher.</p>;
  return <ol className="ml-7 border-l-2 border-border">{events.map(event => <li key={event.id} className="relative flex gap-4 py-5 pl-7">
    <span className="absolute -left-[15px] top-5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card" aria-label={labels[event.type]}>{event.type === "GOAL" ? <CircleDot size={17}/> : event.type === "SUBSTITUTION" ? <ArrowRightLeft size={17}/> : <span className={`h-4 w-3 rounded-sm ${event.type === "RED_CARD" ? "bg-red-600" : "bg-yellow-400"}`}/>}</span>
    <span className="w-14 shrink-0 font-bold tabular-nums text-foreground">{event.minute}{event.extraMinute ? `+${event.extraMinute}` : ""}′</span>
    <div><p className="font-bold text-foreground">{labels[event.type]} · {event.playerName}</p>{event.assistName && <p className="text-sm text-muted-foreground">{event.type === "SUBSTITUTION" ? "Sortant" : "Passeur"} : {event.assistName}</p>}<p className="mt-1 text-xs text-muted-foreground">{event.teamId === homeTeamId ? homeName : awayName}</p></div>
  </li>)}</ol>;
}
