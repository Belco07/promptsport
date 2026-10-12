"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

type FollowResult = { ok: true; following: boolean } | { ok: false; error: string };

async function changeFollow(kind: "team" | "competition", id: string, following: boolean): Promise<FollowResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Connectez-vous pour suivre vos clubs et compétitions." };
  if (typeof id !== "string" || !id.trim() || id.length > 128) return { ok: false, error: "Identifiant invalide." };
  try {
    const changed = await prisma.$transaction(async db => {
      // Serialize read-modify-write of the existing preferences array.
      await db.$queryRaw`SELECT id FROM "Author" WHERE id = ${session.user.id} FOR UPDATE`;
      const user = await db.author.findUnique({ where: { id: session.user.id }, select: { favoriteCompetitions: true } });
      if (!user) return false;
      if (kind === "team") {
        if (!await db.team.findUnique({ where: { id }, select: { id: true } })) return false;
        await db.author.update({ where: { id: session.user.id }, data: { followedTeams: following ? { connect: { id } } : { disconnect: { id } } } });
      } else {
        const competition = await db.competition.findUnique({ where: { id }, select: { slug: true } });
        if (!competition) return false;
        const slugs = new Set(user.favoriteCompetitions);
        if (following) slugs.add(competition.slug); else slugs.delete(competition.slug);
        // SQL trigger maintains the relation and the old preference screens.
        await db.author.update({ where: { id: session.user.id }, data: { favoriteCompetitions: [...slugs] } });
      }
      return true;
    });
    if (!changed) return { ok: false, error: "Ce compte, club ou cette compétition n’existe plus." };
    revalidatePath("/mon-sport");
    revalidatePath("/mon-compte");
    revalidatePath("/mon-compte/favoris");
    revalidatePath("/competition/[slug]", "page");
    return { ok: true, following };
  } catch {
    return { ok: false, error: "Impossible d’enregistrer ce suivi. Réessayez." };
  }
}

export async function followTeam(teamId: string) { return changeFollow("team", teamId, true); }
export async function unfollowTeam(teamId: string) { return changeFollow("team", teamId, false); }
export async function followCompetition(competitionId: string) { return changeFollow("competition", competitionId, true); }
export async function unfollowCompetition(competitionId: string) { return changeFollow("competition", competitionId, false); }
