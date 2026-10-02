import Link from "next/link";

import { MATCH_STATUS_LABELS, type MatchStatus } from "@/components/MatchCard";
import { SportTabs } from "@/components/SportTabs";
import { formatMatchDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";

import { deleteMatch } from "../actions";
import { DeleteButton } from "../DeleteButton";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(MATCH_STATUS_LABELS) as MatchStatus[];

const STATUS_BADGES: Record<MatchStatus, string> = {
  SCHEDULED: "bg-gray-100 text-gray-600",
  LIVE: "bg-red-100 text-red-800",
  FINISHED: "bg-green-100 text-green-800",
  POSTPONED: "bg-orange-100 text-orange-800",
  CANCELLED: "bg-gray-200 text-gray-500",
};

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ competition?: string; status?: string }>;
}) {
  const { competition, status } = await searchParams;

  const where = {
    ...(competition ? { competitionId: competition } : {}),
    ...(status && STATUSES.includes(status as MatchStatus) ? { status: status as MatchStatus } : {}),
  };

  const [matches, competitions] = await Promise.all([
    prisma.match.findMany({
      where,
      orderBy: { scheduledAt: "desc" },
      include: {
        competition: { select: { name: true, slug: true } },
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    }),
    prisma.competition.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Sports</h1>
      <SportTabs />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-gray-900">Matchs</h2>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" action="/backoffice/sports/matches" className="flex flex-wrap items-center gap-2">
            <select name="competition" defaultValue={competition ?? ""} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
              <option value="">Toutes les compétitions</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select name="status" defaultValue={status ?? ""} className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800">
              <option value="">Tous les statuts</option>
              {STATUSES.map((s) => <option key={s} value={s}>{MATCH_STATUS_LABELS[s]}</option>)}
            </select>
            <button type="submit" className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-900">Filtrer</button>
          </form>
          <Link href="/backoffice/sports/matches/new" className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800">
            Nouveau match
          </Link>
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Aucun match.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Compétition</th>
                <th className="px-4 py-3 font-semibold">Domicile</th>
                <th className="px-4 py-3 font-semibold">Extérieur</th>
                <th className="px-4 py-3 font-semibold">Score</th>
                <th className="px-4 py-3 font-semibold">Statut</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {matches.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600">{formatMatchDate(m.scheduledAt)}</td>
                  <td className="px-4 py-3 text-gray-700">{m.competition.name}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.homeTeam.name}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{m.awayTeam.name}</td>
                  <td className="px-4 py-3 text-gray-900">
                    {m.homeScore != null && m.awayScore != null ? `${m.homeScore} - ${m.awayScore}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGES[m.status as MatchStatus]}`}>
                      {MATCH_STATUS_LABELS[m.status as MatchStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/backoffice/sports/matches/${m.id}/edit`} className="text-blue-700 underline hover:text-blue-900">Éditer</Link>
                      <Link href={`/match/${m.id}`} className="text-gray-600 underline hover:text-gray-900">Voir sur le site</Link>
                      <DeleteButton action={deleteMatch} id={m.id} label={`${m.homeTeam.name} - ${m.awayTeam.name}`} />
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
