"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMatchVoteData } from "@/lib/club-digest";
import { revalidatePath } from "next/cache";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function voteForManOfTheMatch(matchId: string, playerId: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Connectez-vous pour voter." };
  if (!consumeRateLimit(`motm:${session.user.id}`, { max: 30, windowMs: 60000 }).allowed) return { ok: false, message: "Patientez avant de voter à nouveau." };
  if (typeof matchId !== "string" || typeof playerId !== "string" || matchId.length > 128 || playerId.length > 128) return { ok: false, message: "Choix invalide." };
  const reader = await prisma.author.findUnique({ where: { id: session.user.id }, select: { bannedUntil: true } });
  if (!reader || (reader.bannedUntil && reader.bannedUntil > new Date())) return { ok: false, message: "Votre compte ne peut pas voter actuellement." };
  const match = await getMatchVoteData(matchId);
  if (!match || match.status !== "FINISHED") return { ok: false, message: "Le vote ouvre après la fin du match." };
  if (!match.candidates.some(player => player.id === playerId)) return { ok: false, message: "Ce joueur ne figure pas parmi les participants renseignés." };
  const saved = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "ManOfTheMatchVote"(id,"matchId","readerId","playerId")
    SELECT ${crypto.randomUUID()},m.id,a.id,${playerId} FROM "Match" m CROSS JOIN "Author" a
    WHERE m.id=${matchId} AND m.status='FINISHED' AND a.id=${session.user.id}
      AND (a."bannedUntil" IS NULL OR a."bannedUntil"<=NOW())
    ON CONFLICT ("matchId","readerId") DO UPDATE SET "playerId"=EXCLUDED."playerId"
    RETURNING id
  `;
  if (!saved.length) return { ok: false, message: "Le vote n’est plus disponible pour ce match." };
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/club/[slug]", "page");
  return { ok: true, message: "Votre vote est enregistré." };
}

export async function toggleClubDigest(clubId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Connexion requise.");
  if (typeof clubId !== "string" || clubId.length > 128) throw new Error("Club invalide.");
  await prisma.$transaction(async tx => {
    // Serialize consent toggles for this account, including the global flag.
    await tx.$queryRaw`SELECT id FROM "Author" WHERE id=${session.user.id} FOR UPDATE`;
    const reader = await tx.author.findUnique({ where: { id: session.user.id }, select: { followedTeams: { where: { id: clubId }, select: { id: true } } } });
    const subscription = await tx.clubDigestSubscription.findUnique({ where: { readerId_clubId: { readerId: session.user.id, clubId } } });
    if (!reader?.followedTeams.length && !subscription?.enabled) throw new Error("Suivez ce club avant d’activer son digest.");
    const enabled = !subscription?.enabled;
    await tx.clubDigestSubscription.upsert({ where: { readerId_clubId: { readerId: session.user.id, clubId } }, create: { readerId: session.user.id, clubId, enabled }, update: { enabled } });
    const active = await tx.clubDigestSubscription.count({ where: { readerId: session.user.id, enabled: true } });
    await tx.author.update({ where: { id: session.user.id }, data: { digestOptIn: active > 0 } });
  });
  revalidatePath("/mon-compte/preferences");
}
