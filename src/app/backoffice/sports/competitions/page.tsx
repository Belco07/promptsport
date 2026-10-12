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
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Sports</h1>
      <SportTabs />

      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Compétitions</h2>
        <Link
          href="/backoffice/sports/competitions/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Nouvelle compétition
        </Link>
      </div>

      {competitions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucune compétition.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Nom</th>
                <th className="px-4 py-3 font-semibold">Sport</th>
                <th className="px-4 py-3 font-semibold">Pays</th>
                <th className="px-4 py-3 font-semibold">Matchs</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {competitions.map((c) => (
                <tr key={c.id} className="hover:bg-muted">
                  <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                  <td className="px-4 py-3 text-foreground">{c.sport}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.country ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c._count.matches}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/backoffice/sports/competitions/${c.id}/edit`} className="text-editorial-link underline hover:text-editorial-link">Éditer</Link>
                      <Link href={`/competition/${c.slug}`} className="text-muted-foreground underline hover:text-foreground">Voir sur le site</Link>
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
