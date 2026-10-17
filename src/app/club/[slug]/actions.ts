"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { voteForManOfTheMatch as vote } from "@/app/match/[id]/actions";

export async function followClub(clubId: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Connectez-vous pour choisir votre club préféré." };
  if (typeof clubId !== "string" || clubId.length > 128) return { ok: false, message: "Club invalide." };
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Author" WHERE id=${session.user.id} FOR UPDATE`;
    const reader = await tx.author.findUnique({ where: { id: session.user.id }, select: { favoriteClubId: true, bannedUntil: true } });
    if (!reader || (reader.bannedUntil && reader.bannedUntil > new Date())) return { ok: false, message: "Choix indisponible pour ce compte." };
    const club = await tx.team.findUnique({ where: { id: clubId }, select: { slug: true } });
    if (!club) return { ok: false, message: "Club introuvable." };
    const preferred = reader.favoriteClubId !== clubId;
    await tx.author.update({ where: { id: session.user.id }, data: { favoriteClubId: preferred ? clubId : null, ...(preferred ? { followedTeams: { connect: { id: clubId } } } : {}) } });
    return { ok: true, message: preferred ? "Votre club préféré est enregistré. Vos autres suivis sont conservés." : "Club préféré retiré. Le suivi du club est conservé." };
  });
  revalidatePath("/club/[slug]", "page");
  revalidatePath("/mon-compte/preferences");
  return result;
}

export async function voteForManOfTheMatch(matchId: string, playerId: string) {
  return vote(matchId, playerId);
}

export async function setClubDigest(clubId: string, enabled: boolean) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Connexion requise.");
  if (typeof clubId !== "string" || clubId.length > 128 || typeof enabled !== "boolean") throw new Error("Choix invalide.");
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Author" WHERE id=${session.user.id} FOR UPDATE`;
    const reader = await tx.author.findUnique({ where: { id: session.user.id }, select: { followedTeams: { where: { id: clubId }, select: { id: true } } } });
    if (!reader?.followedTeams.length && enabled) throw new Error("Suivez ce club avant d’activer le digest.");
    if (!await tx.team.findUnique({ where: { id: clubId }, select: { id: true } })) throw new Error("Club introuvable.");
    await tx.clubDigestSubscription.upsert({ where: { readerId_clubId: { readerId: session.user.id, clubId } }, create: { readerId: session.user.id, clubId, enabled }, update: { enabled } });
    const count = await tx.clubDigestSubscription.count({ where: { readerId: session.user.id, enabled: true } });
    await tx.author.update({ where: { id: session.user.id }, data: { digestOptIn: count > 0 } });
  });
  revalidatePath("/mon-compte/preferences");
}
