import type { MatchLineup as Lineup } from "@/generated/prisma/client";
type Player = { name: string; number: number | null; position: string | null };
function players(value: unknown): Player[] {
  return Array.isArray(value) ? value.filter((item): item is Player => typeof item === "object" && item !== null && typeof item.name === "string") : [];
}
function positions(starters: Player[], formation: string | null) {
  const lines = formation?.split("-").map(Number) ?? [];
  if (!lines.length || !lines.every(n => Number.isInteger(n) && n > 0 && n <= 6) || lines.reduce((a, b) => a + b, 1) !== starters.length) return null;
  const keeper = starters.find(player => player.position === "G") ?? starters[0];
  const ordered = [keeper, ...starters.filter(player => player !== keeper)];
  let index = 0;
  return [1, ...lines].flatMap((count, line, all) => Array.from({ length: count }, (_, column) => ({ player: ordered[index++], x: 340 / (count + 1) * (column + 1), y: 405 - line * 340 / (all.length - 1) })));
}
export function MatchLineup({ lineups, homeTeamId, homeName, awayName }: { lineups: Lineup[]; homeTeamId: string; homeName: string; awayName: string }) {
  if (!lineups.length) return <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">Disponible prochainement</p>;
  return <div className="grid gap-6 md:grid-cols-2">{[homeTeamId, lineups.find(row => row.teamId !== homeTeamId)?.teamId].map((teamId, side) => {
    const lineup = lineups.find(row => row.teamId === teamId), name = side ? awayName : homeName;
    if (!lineup) return <p key={side} className="p-6 text-muted-foreground">{name} : disponible prochainement</p>;
    const starters = players(lineup.starters), substitutes = players(lineup.substitutes), layout = positions(starters, lineup.formation);
    return <section key={side} className="overflow-hidden rounded-xl border border-border bg-card"><div className="p-5"><h3 className="font-bold text-foreground">{name} <span className="text-sm text-muted-foreground">{lineup.formation}</span></h3>{lineup.coach && <p className="mt-1 text-sm text-muted-foreground">Entraîneur : {lineup.coach}</p>}</div>{layout && <svg viewBox="0 0 340 460" role="img" aria-label={`Placement indicatif de ${name}, formation ${lineup.formation}`} className="w-full bg-green-900"><g fill="none" stroke="white" opacity="0.4"><rect x="12" y="12" width="316" height="436"/><path d="M12 230H328M100 12V80H240V12M100 448V380H240V448"/><circle cx="170" cy="230" r="40"/></g>{layout.map(({ player, x, y }, index) => <g key={index}><circle cx={x} cy={y} r="14" fill="white"/><text x={x} y={y + 4} textAnchor="middle" fontSize="12" fill="#14532d" fontWeight="bold">{player.number ?? "·"}</text><text x={x} y={y + 29} textAnchor="middle" fontSize="10" fill="white">{player.name.split(" ").at(-1)?.slice(0, 16)}</text></g>)}</svg>}{layout && <p className="px-5 pt-3 text-xs text-muted-foreground">Placement indicatif selon la formation annoncée.</p>}<div className="p-5"><h4 className="mb-2 font-bold text-foreground">Titulaires</h4><ul className="space-y-1 text-sm text-foreground">{starters.map((player, index) => <li key={index}>{player.number ?? "—"} · {player.name}</li>)}</ul><h4 className="mb-2 mt-5 font-bold text-foreground">Remplaçants</h4><ul className="space-y-1 text-sm text-muted-foreground">{substitutes.map((player, index) => <li key={index}>{player.number ?? "—"} · {player.name}</li>)}</ul></div></section>;
  })}</div>;
}
