"use server";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function completeWelcome(form: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const selected = form.getAll("competition").filter((value): value is string => typeof value === "string").slice(0, 30);
  const valid = await prisma.competition.findMany({ where: { slug: { in: selected } }, select: { slug: true } });
  await prisma.author.update({ where: { id: session.user.id }, data: { welcomeCompleted: true, ...(form.get("intent") === "save" ? { favoriteCompetitions: valid.map(c => c.slug) } : {}) } });
  redirect(form.get("returnTo") === "favorites" ? "/mon-compte/favoris" : "/mon-compte");
}
