import type { StandingRow } from "@/lib/standings";

/**
 * Tableau de classement d'une compétition.
 * Responsive : enveloppé dans un conteneur à défilement horizontal.
 */
export function StandingsTable({ rows }: { rows: StandingRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
        Aucun classement disponible (pas encore de match terminé).
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-3 font-semibold">#</th>
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
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, index) => (
            <tr key={row.teamId} className="hover:bg-gray-50">
              <td className="px-3 py-2.5 text-gray-500">{index + 1}</td>
              <td className="px-3 py-2.5 font-medium text-gray-900">{row.teamName}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">{row.played}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">{row.won}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">{row.drawn}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">{row.lost}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">{row.goalsFor}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">{row.goalsAgainst}</td>
              <td className="px-3 py-2.5 text-center text-gray-700">
                {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
              </td>
              <td className="px-3 py-2.5 text-center font-bold text-gray-900">{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
