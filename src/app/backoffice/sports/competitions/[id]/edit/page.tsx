import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { updateCompetition } from "../../../actions";
import { CompetitionForm } from "../../../CompetitionForm";

export const dynamic = "force-dynamic";

export default async function EditCompetitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const competition = await prisma.competition.findUnique({ where: { id } });
  if (!competition) notFound();

  const updateWithId = updateCompetition.bind(null, competition.id);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
        Modifier la compétition
      </h1>
      <p className="mb-6 text-sm text-gray-500">/{competition.slug}</p>
      <CompetitionForm
        action={updateWithId}
        defaultValues={{
          name: competition.name,
          slug: competition.slug,
          sport: competition.sport,
          country: competition.country ?? "",
          season: competition.season ?? "",
        }}
        submitLabel="Mettre à jour"
      />
    </div>
  );
}
