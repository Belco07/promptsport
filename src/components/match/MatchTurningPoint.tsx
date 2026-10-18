import Link from "next/link";
import type { MatchEvent } from "@/generated/prisma/client";
import { playerProfileKey } from "@/lib/slug";
export function MatchTurningPoint({ events, homeTeamId, homeName, awayName, playerLinks = {} }: { events: MatchEvent[]; homeTeamId: string; homeName: string; awayName: string; playerLinks?: Record<string, string> }) {
  const ordered = [...events].sort((a, b) => b.minute - a.minute || (b.extraMinute ?? 0) - (a.extraMinute ?? 0));
  const event = ordered.find(item => item.type === "RED_CARD") ?? ordered.find(item => item.type === "GOAL");
  if (!event) return null;
  const href = playerLinks[playerProfileKey(event.teamId, event.playerName)];
  return <aside aria-labelledby="turning-point-title" className="my-8 border-l-4 border-editorial-link bg-accent/10 p-6 md:p-8"><p className="text-xs font-bold uppercase tracking-widest text-editorial-link">Le Tournant du Match</p><h3 id="turning-point-title" className="mt-3 text-2xl font-black text-foreground md:text-3xl">{event.minute}{event.extraMinute ? '+' + event.extraMinute : ''}′ · {href ? <Link href={href} className="hover:underline">{event.playerName}</Link> : event.playerName}</h3><p className="mt-3 text-muted-foreground">{event.type === "RED_CARD" ? "Un carton rouge qui change le rapport de forces" : "Le dernier but enregistré dans cette rencontre"} · {event.teamId === homeTeamId ? homeName : awayName}.</p></aside>;
}
