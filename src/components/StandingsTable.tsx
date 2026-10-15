import Image from "next/image";
import type { StandingRow } from "@/lib/standings";
import { NEUTRAL_STANDINGS_RULES, STANDINGS_ZONES, standingsZone, type StandingsRules } from "@/components/StandingsLegend";

/**
 * Tableau de classement d'une compétition.
 * Responsive : enveloppé dans un conteneur à défilement horizontal.
 */
export function StandingsTable({ rows, logos = {}, rules = NEUTRAL_STANDINGS_RULES, totalTeams = rows.length }: { rows: StandingRow[]; logos?: Record<string,string|null>; competitionSlug?: string; rules?: StandingsRules; totalTeams?: number }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Aucun classement disponible (pas encore de match terminé).
      </p>
    );
  }

  return (
    <div tabIndex={0} aria-label="Classement : faites défiler pour voir toutes les colonnes" className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="min-w-[720px] w-full text-left text-sm">
        <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-3 font-semibold">#</th>
            <th className="px-3 py-3 font-semibold">Équipe</th>
            <th className="px-3 py-3 text-center font-semibold">J</th>
            <th className="px-3 py-3 text-center font-semibold">G</th>
            <th className="px-3 py-3 text-center font-semibold">N</th>
            <th className="px-3 py-3 text-center font-semibold">P</th>
            <th className="px-3 py-3 text-center font-semibold">BP</th>
            <th className="px-3 py-3 text-center font-semibold">BC</th>
            <th className="px-3 py-3 text-center font-semibold">Diff</th>
            <th className="px-3 py-3 text-center font-semibold">Pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, index) => {
            const position = index + 1;
            const zone = standingsZone(position, Math.max(totalTeams, rows.length), rules);
            const style = zone ? STANDINGS_ZONES[zone] : null;
            const label = `Position ${position}${style ? ` — ${style.description}` : ""}`;
            return <tr key={row.teamId} title={label} className={style?.row ?? "hover:bg-muted"}>
              <td className={`border-l-4 px-3 py-2.5 text-foreground ${style?.border ?? "border-l-transparent"}`}><span className="inline-flex min-w-16 items-center justify-end gap-2"><span className="flex h-7 w-7 items-center justify-center">{style?.logo && <Image src={`https://media.api-sports.io/football/leagues/${style.logo}.png`} alt="" width={24} height={24} sizes="24px" style={{ backgroundColor: "#fff" }} className="h-7 w-7 rounded-sm p-0.5 object-contain" />}</span><span className="w-6 text-right font-bold tabular-nums">{position}</span><span className="sr-only">{style ? ` — ${style.description}` : ""}</span></span></td>
              <td className="px-3 py-2.5 font-medium text-foreground"><span className="flex items-center gap-3">{logos[row.teamId] && <Image src={logos[row.teamId]!} alt="" width={28} height={28} loading="lazy" className="h-7 w-7 object-contain"/>}{row.teamName}</span></td>
              <td className="px-3 py-2.5 text-center text-foreground">{row.played}</td>
              <td className="px-3 py-2.5 text-center text-foreground">{row.won}</td>
              <td className="px-3 py-2.5 text-center text-foreground">{row.drawn}</td>
              <td className="px-3 py-2.5 text-center text-foreground">{row.lost}</td>
              <td className="px-3 py-2.5 text-center text-foreground">{row.goalsFor}</td>
              <td className="px-3 py-2.5 text-center text-foreground">{row.goalsAgainst}</td>
              <td className="px-3 py-2.5 text-center text-foreground">
                {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
              </td>
              <td className="px-3 py-2.5 text-center font-bold text-foreground">{row.points}</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
