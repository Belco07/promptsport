import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { updateTeam } from "../../../actions";
import { TeamForm } from "../../../TeamForm";

export const dynamic = "force-dynamic";

export default async function EditTeamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) notFound();

  const updateWithId = updateTeam.bind(null, team.id);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">Modifier l&apos;équipe</h1>
      <p className="mb-6 text-sm text-gray-500">/{team.slug}</p>
      <TeamForm
        action={updateWithId}
        defaultValues={{
          name: team.name,
          slug: team.slug,
          shortName: team.shortName ?? "",
          sport: team.sport,
          country: team.country ?? "",
          logoUrl: team.logoUrl ?? "",
        }}
        submitLabel="Mettre à jour"
      />
    </div>
  );
}
