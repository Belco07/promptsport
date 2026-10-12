import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { completeWelcome } from "@/app/bienvenue/actions";
import { Button } from "@/components/ui/Button";
export const metadata = { title: "Personnaliser mes favoris" };
export default async function PersonalizePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [user, competitions] = await Promise.all([
    prisma.author.findUniqueOrThrow({ where: { id: session.user.id }, select: { favoriteCompetitions: true } }),
    prisma.competition.findMany({ orderBy: { name: "asc" }, select: { name: true, slug: true } }),
  ]);
  return <main id="contenu" className="py-10"><h1 className="text-3xl font-black">Mes compétitions préférées</h1><p className="mt-3 text-muted-foreground">Choisissez les compétitions à retrouver dans vos favoris.</p><form action={completeWelcome} className="mt-8 space-y-6"><input type="hidden" name="returnTo" value="favorites" /><input type="hidden" name="intent" value="save" /><div className="grid gap-3 sm:grid-cols-2">{competitions.map(c => <label key={c.slug} className="flex items-center gap-3 border border-border bg-card p-5"><input type="checkbox" name="competition" value={c.slug} defaultChecked={user.favoriteCompetitions.includes(c.slug)} className="h-5 w-5" />{c.name}</label>)}</div><Button type="submit">Enregistrer mes préférences</Button></form></main>;
}
