import { ScoreRow } from "@/components/ScoreRow";
import type { MatchCardData } from "@/components/MatchCard";

export type CompetitionListMatch = MatchCardData & { matchday: number | null; roundName: string | null };

export function matchRoundLabel(match: Pick<CompetitionListMatch, "matchday" | "roundName">, total: number | null): string {
  if (match.roundName && !/^(league phase|regular season)$/i.test(match.roundName)) {
    return ({ "Playoff round": "Barrages", "Round of 16": "Huitièmes de finale", Quarterfinals: "Quarts de finale", Semifinals: "Demi-finales", Final: "Finale" } as Record<string,string>)[match.roundName] ?? match.roundName;
  }
  if (!match.matchday) return "Journée non renseignée";
  if (!total || match.matchday > total) return `Journée ${match.matchday}`;
  const remaining = total - match.matchday;
  return `Journée ${match.matchday}/${total} — ${remaining} journée${remaining > 1 ? "s" : ""} restante${remaining > 1 ? "s" : ""}`;
}

export function groupCompetitionMatches(matches: CompetitionListMatch[], total: number | null) {
  const groups = new Map<string, { date: string; dateLabel: string; round: string; matches: CompetitionListMatch[] }>();
  for (const match of matches) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(match.scheduledAt);
    const round = matchRoundLabel(match, total), key = `${date}/${round}`;
    const group = groups.get(key) ?? { date, dateLabel: match.scheduledAt.toLocaleDateString("fr-FR", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long", year: "numeric" }), round, matches: [] };
    group.matches.push(match); groups.set(key, group);
  }
  return [...groups.values()];
}

export function CompetitionMatchList({ matches, totalMatchdays }: { matches: CompetitionListMatch[]; totalMatchdays: number | null }) {
  return <div className="space-y-5">{groupCompetitionMatches(matches, totalMatchdays).map(group => <section key={`${group.date}/${group.round}`} aria-labelledby={`fixtures-${group.matches[0].id}`} className="overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-3">
      <h3 id={`fixtures-${group.matches[0].id}`} className="text-sm font-semibold capitalize text-foreground"><time dateTime={group.date}>{group.dateLabel}</time></h3>
      <p className="text-xs font-medium text-muted-foreground">{group.round}</p>
    </div>
    <div className="divide-y divide-border">{group.matches.map(match => <ScoreRow key={match.id} match={match} />)}</div>
  </section>)}</div>;
}
