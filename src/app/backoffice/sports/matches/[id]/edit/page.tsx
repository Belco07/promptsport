import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { updateMatch } from "../../../actions";
import { MatchForm } from "../../../MatchForm";

export const dynamic = "force-dynamic";

export default async function EditMatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [match, competitions, teams] = await Promise.all([
    prisma.match.findUnique({ where: { id } }),
    prisma.competition.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  if (!match) notFound();

  const updateWithId = updateMatch.bind(null, match.id);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Modifier le match</h1>
      <MatchForm
        action={updateWithId}
        competitions={competitions}
        teams={teams}
        defaultValues={{
          competitionId: match.competitionId,
          homeTeamId: match.homeTeamId,
          awayTeamId: match.awayTeamId,
          scheduledAt: match.scheduledAt.toISOString(),
          status: match.status,
          homeScore: match.homeScore != null ? String(match.homeScore) : "",
          awayScore: match.awayScore != null ? String(match.awayScore) : "",
          venue: match.venue ?? "",
        }}
        submitLabel="Mettre à jour"
      />
    </div>
  );
}
