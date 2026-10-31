"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMatchVoteData } from "@/lib/club-digest";
import { revalidatePath } from "next/cache";
import { consumeRateLimit, MATCH_COMMENT_RATE_LIMIT } from "@/lib/rate-limit";

export async function getMatchDiscussion(matchId: string, phase: string) {
  if (typeof matchId !== "string" || !matchId || matchId.length > 128 || !["PRE_MATCH", "LIVE", "POST_MATCH"].includes(phase)) throw new Error("Discussion invalide.");
  const selectedPhase = phase as "PRE_MATCH" | "LIVE" | "POST_MATCH";
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const visible = { matchId, OR: [{ status: "APPROVED" as const }, ...(userId ? [{ status: "PENDING" as const, OR: [{ readerId: userId }, { authorId: userId }] }] : [])] };
  const [comments, counts, reader] = await Promise.all([
    prisma.matchComment.findMany({ where: { ...visible, phase: selectedPhase }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { reader: { select: { name: true } }, author: { select: { name: true } }, parent: { select: { status: true, reader: { select: { name: true } }, author: { select: { name: true } } } } } }),
    prisma.matchComment.groupBy({ by: ["phase"], where: visible, _count: { _all: true } }),
    userId ? prisma.author.findUnique({ where: { id: userId }, select: { bannedUntil: true } }) : Promise.resolve(null),
  ]);
  return { phase: selectedPhase, userId, banned: !!reader?.bannedUntil && reader.bannedUntil > new Date(), counts: Object.fromEntries(counts.map(row => [row.phase, row._count._all])),
    comments: comments.map(row => ({ id: row.id, content: row.content, status: row.status, createdAt: row.createdAt.toISOString(), name: row.reader?.name ?? row.author?.name ?? "Compte supprimé", ownerId: row.readerId ?? row.authorId, parentId: row.parentId, parentName: row.parent?.status === "APPROVED" ? row.parent.reader?.name ?? row.parent.author?.name ?? "Compte supprimé" : null })) };
}

export async function createMatchComment(matchId: string, _previous: { ok: boolean; message: string; savedId: string }, form: FormData) {
  const session = await auth();
  const fail = (message: string) => ({ ok: false, message, savedId: "", comment: null });
  if (!session?.user?.id) return fail("Connectez-vous pour commenter.");
  const value = form.get("content"), parentValue = form.get("parentId");
  if (typeof matchId !== "string" || !matchId || matchId.length > 128 || typeof value !== "string" || !value.trim() || value.trim().length > 1000 || (parentValue !== null && (typeof parentValue !== "string" || parentValue.length > 128))) return fail("Saisissez un commentaire de 1 à 1 000 caractères.");
  const content = value.trim(), parentId = typeof parentValue === "string" && parentValue ? parentValue : null;
  const result = await prisma.$transaction(async tx => {
    // The account lock serializes concurrent submissions across all Vercel instances.
    await tx.$queryRaw`SELECT id FROM "Author" WHERE id=${session.user.id} FOR UPDATE`;
    const user = await tx.author.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, role: true, isPremium: true, bannedUntil: true } });
    if (!user || (user.bannedUntil && user.bannedUntil > new Date())) return fail("Votre compte ne peut pas commenter actuellement.");
    const match = await tx.match.findUnique({ where: { id: matchId }, select: { status: true } });
    if (!match) return fail("Match introuvable.");
    const count = await tx.matchComment.count({ where: { matchId, OR: [{ readerId: user.id }, { authorId: user.id }], createdAt: { gt: new Date(Date.now() - MATCH_COMMENT_RATE_LIMIT.windowMs) } } });
    if (count >= MATCH_COMMENT_RATE_LIMIT.max) return fail("Vous avez atteint la limite de 10 commentaires par match et par heure.");
    const parent = parentId ? await tx.matchComment.findUnique({ where: { id: parentId }, select: { matchId: true, parentId: true, status: true, readerId: true, authorId: true, reader: { select: { name: true } }, author: { select: { name: true } } } }) : null;
    if (parentId && (!parent || parent.matchId !== matchId || parent.parentId || parent.status !== "APPROVED")) return fail("Ce commentaire ne peut pas recevoir de réponse.");
    const subscription = user.isPremium ? true : !!await tx.subscription.findFirst({ where: { userId: user.id, status: { in: ["ACTIVE", "TRIALING"] }, currentPeriodEnd: { gt: new Date() } }, select: { id: true } });
    const approved = subscription || user.role === "ADMIN" || user.role === "EDITOR";
    const comment = await tx.matchComment.create({ data: {
      matchId, content, parentId, readerId: user.role === "READER" ? user.id : null, authorId: user.role === "READER" ? null : user.id,
      phase: match.status === "LIVE" ? "LIVE" : match.status === "FINISHED" ? "POST_MATCH" : "PRE_MATCH",
      status: approved ? "APPROVED" : "PENDING",
    } });
    const recipient = parent?.readerId ?? parent?.authorId;
    if (approved && recipient && recipient !== user.id) await tx.notification.create({ data: { userId: recipient, type: "COMMENT_REPLY", title: "Nouvelle réponse dans la discussion du match", message: `${user.name} a répondu à votre commentaire.`, linkUrl: `/match/${matchId}?tab=discussion&phase=${comment.phase}#match-comment-${comment.id}` } });
    return { ok: true, message: approved ? "Votre commentaire est publié." : "Votre commentaire est en attente de modération.", savedId: comment.id,
      comment: { id: comment.id, content: comment.content, status: comment.status, phase: comment.phase, createdAt: comment.createdAt.toISOString(), name: user.name, ownerId: user.id, parentId: comment.parentId, parentName: parent?.reader?.name ?? parent?.author?.name ?? null } };
  });
  // Return the confirmed comment instead of coupling mutation success to a
  // revalidated RSC tree. The thread merges it with subsequent server renders.
  return result;
}

export async function deleteMatchComment(matchId: string, commentId: string) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, message: "Connexion requise." };
  if (typeof matchId !== "string" || typeof commentId !== "string" || matchId.length > 128 || commentId.length > 128) return { ok: false, message: "Commentaire invalide." };
  const result = await prisma.matchComment.updateMany({ where: { id: commentId, matchId, OR: [{ readerId: session.user.id }, { authorId: session.user.id }], status: { not: "DELETED" } }, data: { status: "DELETED" } });
  revalidatePath(`/match/${matchId}`);
  return { ok: !!result.count, message: result.count ? "Commentaire supprimé." : "Commentaire indisponible." };
}

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
  const updated = await getMatchVoteData(matchId, session.user.id);
  revalidatePath(`/match/${matchId}`);
  revalidatePath("/club/[slug]", "page");
  return { ok: true, message: "Votre vote est enregistré.", vote: { choice: playerId, results: updated?.results ?? [] } };
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
