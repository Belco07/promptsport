import { prisma } from "@/lib/prisma";

import { createMatch } from "../../actions";
import { MatchForm } from "../../MatchForm";

export const dynamic = "force-dynamic";

export default async function NewMatchPage() {
  const [competitions, teams] = await Promise.all([
    prisma.competition.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Nouveau match</h1>
      <MatchForm
        action={createMatch}
        competitions={competitions}
        teams={teams}
        submitLabel="Créer le match"
      />
    </div>
  );
}
