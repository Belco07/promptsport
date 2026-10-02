import Link from "next/link";

import { SportTabs } from "@/components/SportTabs";
import { prisma } from "@/lib/prisma";

import { deleteTeam } from "../actions";
import { DeleteButton } from "../DeleteButton";

export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { homeMatches: true, awayMatches: true } } },
  });

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Sports</h1>
      <SportTabs />

      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-900">Équipes</h2>
        <Link
          href="/backoffice/sports/teams/new"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Nouvelle équipe
        </Link>
      </div>

      {teams.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Aucune équipe.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Nom</th>
                <th className="px-4 py-3 font-semibold">Abrév.</th>
                <th className="px-4 py-3 font-semibold">Sport</th>
                <th className="px-4 py-3 font-semibold">Pays</th>
                <th className="px-4 py-3 font-semibold">Logo</th>
                <th className="px-4 py-3 font-semibold">Matchs</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {teams.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-4 py-3 text-gray-600">{t.shortName ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{t.sport}</td>
                  <td className="px-4 py-3 text-gray-600">{t.country ?? "—"}</td>
                  <td className="px-4 py-3">
                    {t.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- logo externe
                      <img src={t.logoUrl} alt="" className="h-8 w-8 rounded-full object-contain" />
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {t._count.homeMatches + t._count.awayMatches}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/backoffice/sports/teams/${t.id}/edit`} className="text-blue-700 underline hover:text-blue-900">Éditer</Link>
                      <DeleteButton action={deleteTeam} id={t.id} label={t.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
