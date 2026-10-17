import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";

import { prisma } from "@/lib/prisma";

import { updateTeam } from "../../../actions";
import { TeamForm } from "../../../TeamForm";

export const dynamic = "force-dynamic";

async function saveRivalries(teamId: string, formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Accès administrateur requis.");
  const raw = formData.getAll("rivalClubIds");
  if (raw.length > 32 || raw.some(value => typeof value !== "string" || value.length > 128 || value === teamId)) throw new Error("Sélection de rivaux invalide.");
  const ids = [...new Set(raw as string[])];
  const valid = await prisma.team.count({ where: { id: { in: ids } } });
  if (valid !== ids.length) throw new Error("Un des clubs sélectionnés n’existe plus.");
  await prisma.team.update({ where: { id: teamId }, data: { rivalClubIds: ids } });
  revalidatePath("/club/[slug]", "page");
  revalidatePath(`/backoffice/sports/teams/${teamId}/edit`);
  redirect(`/backoffice/sports/teams/${teamId}/edit?rivalites=1`);
}

export default async function EditTeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rivalites?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/studio");
  const { id } = await params;
  const team = await prisma.team.findUnique({ where: { id } });
  if (!team) notFound();
  const [choices, query] = await Promise.all([prisma.team.findMany({ where: { id: { not: team.id }, sport: team.sport }, orderBy: { name: "asc" }, select: { id: true, name: true } }), searchParams]);
  const selected = Array.isArray(team.rivalClubIds) ? team.rivalClubIds.filter((id): id is string => typeof id === "string") : [];

  const updateWithId = updateTeam.bind(null, team.id);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Modifier l&apos;équipe</h1>
      <p className="mb-6 text-sm text-muted-foreground">/{team.slug}</p>
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
      <section className="mt-10 max-w-2xl border-t border-border pt-6"><h2 className="text-xl font-bold text-foreground">Rivalités</h2>{query.rivalites === "1" && <p role="status" className="mt-3 text-sm text-status-success-foreground">Rivalités enregistrées.</p>}<form action={saveRivalries.bind(null, team.id)} className="mt-4 space-y-4"><label htmlFor="rival-clubs" className="block text-sm font-semibold text-foreground">Clubs rivaux</label><p id="rival-help" className="text-sm text-muted-foreground">Choisissez jusqu’à 32 clubs. Maintenez Ctrl ou Cmd pour sélectionner plusieurs clubs ou retirer une sélection. Ce réglage concerne cette équipe.</p><select id="rival-clubs" name="rivalClubIds" multiple size={8} defaultValue={selected} aria-describedby="rival-help" className="w-full rounded-lg border border-border bg-background p-3 text-foreground">{choices.map(club => <option key={club.id} value={club.id}>{club.name}</option>)}</select><button className="min-h-11 rounded-lg bg-secondary px-4 py-2 font-bold text-foreground">Enregistrer les rivalités</button></form></section>
    </div>
  );
}
