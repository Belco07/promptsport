import Link from "next/link";

import { SportTabs } from "@/components/SportTabs";
import { prisma } from "@/lib/prisma";

import { deleteCompetition } from "../actions";
import { DeleteButton } from "../DeleteButton";

export const dynamic = "force-dynamic";

export default async function CompetitionsPage() {
  const competitions = await prisma.competition.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { matches: true } } },
  });

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Sports</h1>
      <SportTabs />

      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-900">Compétitions</h2>
        <Link
          href="/backoffice/sports/competitions/new"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Nouvelle compétition
        </Link>
      </div>

      {competitions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Aucune compétition.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Nom</th>
                <th className="px-4 py-3 font-semibold">Sport</th>
                <th className="px-4 py-3 font-semibold">Pays</th>
                <th className="px-4 py-3 font-semibold">Matchs</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {competitions.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                  <td className="px-4 py-3 text-gray-700">{c.sport}</td>
                  <td className="px-4 py-3 text-gray-600">{c.country ?? "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{c._count.matches}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/backoffice/sports/competitions/${c.id}/edit`} className="text-blue-700 underline hover:text-blue-900">Éditer</Link>
                      <Link href={`/competition/${c.slug}`} className="text-gray-600 underline hover:text-gray-900">Voir sur le site</Link>
                      <DeleteButton action={deleteCompetition} id={c.id} label={c.name} />
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
