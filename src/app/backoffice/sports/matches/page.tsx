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
  SCHEDULED: "bg-muted text-muted-foreground",
  LIVE: "bg-status-error text-status-error-foreground",
  FINISHED: "bg-status-success text-status-success-foreground",
  POSTPONED: "bg-orange-100 text-orange-800",
  CANCELLED: "bg-muted text-muted-foreground",
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
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Sports</h1>
      <SportTabs />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">Matchs</h2>
        <div className="flex flex-wrap items-center gap-2">
          <form method="get" action="/backoffice/sports/matches" className="flex flex-wrap items-center gap-2">
            <select name="competition" defaultValue={competition ?? ""} className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground">
              <option value="">Toutes les compétitions</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select name="status" defaultValue={status ?? ""} className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground">
              <option value="">Tous les statuts</option>
              {STATUSES.map((s) => <option key={s} value={s}>{MATCH_STATUS_LABELS[s]}</option>)}
            </select>
            <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover">Filtrer</button>
          </form>
          <Link href="/backoffice/sports/matches/new" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover">
            Nouveau match
          </Link>
        </div>
      </div>

      {matches.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun match.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
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
            <tbody className="divide-y divide-border">
              {matches.map((m) => (
                <tr key={m.id} className="hover:bg-muted">
                  <td className="px-4 py-3 text-muted-foreground">{formatMatchDate(m.scheduledAt)}</td>
                  <td className="px-4 py-3 text-foreground">{m.competition.name}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{m.homeTeam.name}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{m.awayTeam.name}</td>
                  <td className="px-4 py-3 text-foreground">
                    {m.homeScore != null && m.awayScore != null ? `${m.homeScore} - ${m.awayScore}` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGES[m.status as MatchStatus]}`}>
                      {MATCH_STATUS_LABELS[m.status as MatchStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link href={`/backoffice/sports/matches/${m.id}/edit`} className="text-editorial-link underline hover:text-editorial-link">Éditer</Link>
                      <Link href={`/match/${m.id}`} className="text-muted-foreground underline hover:text-foreground">Voir sur le site</Link>
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
