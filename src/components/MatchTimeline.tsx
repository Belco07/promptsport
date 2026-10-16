import { ArrowRightLeft, CircleDot, CircleX } from "lucide-react";
import type { MatchEvent } from "@/generated/prisma/client";
import Link from "next/link";
import { playerProfileKey } from "@/lib/slug";

const labels = { GOAL: "But", MISSED_PENALTY: "Penalty manqué", YELLOW_CARD: "Carton jaune", RED_CARD: "Carton rouge", SUBSTITUTION: "Remplacement" };
export function MatchTimeline({ events, homeTeamId, homeName, awayName, commentary = false, playerLinks = {} }: { events: MatchEvent[]; homeTeamId: string; homeName: string; awayName: string; commentary?: boolean; playerLinks?: Record<string, string> }) {
  const playerName = (teamId: string, name: string) => { const href = playerLinks[playerProfileKey(teamId, name)]; return href ? <Link href={href} className="font-semibold hover:underline focus-visible:outline-2">{name}</Link> : name; };
  if (!events.length) return <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">Disponible prochainement — aucun événement à afficher.</p>;
  if (commentary) return <div><p className="mb-5 text-sm text-muted-foreground">Fil automatique à partir des événements du match. Les plus récents apparaissent en premier.</p><ol className="divide-y divide-border rounded-xl border border-border bg-card">{[...events].reverse().map(event => {
    const team = event.teamId === homeTeamId ? homeName : awayName;
    const name = playerName(event.teamId, event.playerName);
    const assist = event.assistName ? playerName(event.teamId, event.assistName) : null;
    const text = event.type === "GOAL" ? <>But de {name} pour {team}.{assist && <> Passe décisive de {assist}.</>}</> : event.type === "SUBSTITUTION" ? <>{team} : {name} entre en jeu{assist && <> à la place de {assist}</>}.</> : <>{labels[event.type]} pour {name} ({team}).</>;
    return <li key={event.id} className="flex gap-4 p-5"><span className="w-14 shrink-0 font-bold tabular-nums text-editorial-link">{event.minute}{event.extraMinute ? `+${event.extraMinute}` : ""}′</span><p className="text-sm leading-relaxed text-foreground">{text}</p></li>;
  })}</ol></div>;
  // Le marqueur visuel (pastille, carton) est décoratif : le type d'événement
  // est écrit en toutes lettres dans la ligne (« But · X », « Carton jaune · Y »).
  return <ol className="ml-7 border-l-2 border-border">{events.map(event => <li key={event.id} className="relative flex gap-4 py-5 pl-7">
    <span aria-hidden="true" className="absolute -left-[15px] top-5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card">{event.type === "GOAL" ? <CircleDot size={17}/> : event.type === "MISSED_PENALTY" ? <CircleX size={17} className="text-status-danger"/> : event.type === "SUBSTITUTION" ? <ArrowRightLeft size={17}/> : <span className={`h-4 w-3 rounded-sm ${event.type === "RED_CARD" ? "bg-red-600" : "bg-yellow-400"}`}/>}</span>
    <span className="w-14 shrink-0 font-bold tabular-nums text-foreground">{event.minute}{event.extraMinute ? `+${event.extraMinute}` : ""}′</span>
    <div><p className="font-bold text-foreground">{labels[event.type]} · {playerName(event.teamId, event.playerName)}</p>{event.assistName && <p className="text-sm text-muted-foreground">{event.type === "SUBSTITUTION" ? "Sortant" : "Passeur"} : {playerName(event.teamId, event.assistName)}</p>}<p className="mt-1 text-xs text-muted-foreground">{event.teamId === homeTeamId ? homeName : awayName}</p></div>
  </li>)}</ol>;
}
