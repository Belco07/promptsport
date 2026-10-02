"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  ARTICLE_REACTION_TYPES,
  PUBLIC_COMMENT_REACTIONS,
  REACTION_LABELS,
  bannedCommentMessage,
  isBanned,
  isReactionType,
  isReportReason,
  isValidCommentLength,
  type EngagementResult,
  type ReactionCounts,
  type ReactionState,
  type ReactionType,
  type ReportReason,
} from "@/lib/engagement";
import { formatDate } from "@/lib/formatDate";
import { notifyCommentReaction, notifyCommentReply } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { COMMENT_RATE_LIMIT, consumeRateLimit } from "@/lib/rate-limit";

/**
 * Actions publiques d'engagement (WP10b) : dépôt d'un commentaire, réactions sur
 * un commentaire ou sur un article, signalement d'un commentaire.
 *
 * Sécurité : chaque action vérifie la session, le bannissement de l'auteur et
 * la validité des valeurs reçues (types de réaction, raisons de signalement).
 * Une Server Action est un point d'entrée HTTP à part entière : ces contrôles ne
 * peuvent pas reposer sur l'interface.
 */

/* ------------------------------------------------------------------ helpers */

type Viewer = {
  id: string;
  name: string;
  bannedUntil: Date | null;
  banReason: string | null;
};

/** Session + état de bannissement, ou une erreur prête à renvoyer. */
async function requireViewer(): Promise<{ viewer: Viewer } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Connectez-vous pour participer." };
  }

  const author = await prisma.author.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, bannedUntil: true, banReason: true },
  });

  if (!author) {
    return { error: "Connectez-vous pour participer." };
  }

  if (isBanned(author)) {
    return { error: bannedCommentMessage(author.banReason, formatDate(author.bannedUntil)) };
  }

  return { viewer: author };
}

/** Compteurs et réaction de l'utilisateur pour un commentaire. */
async function commentReactionState(commentId: string, viewerId: string): Promise<ReactionState> {
  const [grouped, mine] = await Promise.all([
    prisma.commentReaction.groupBy({ by: ["type"], where: { commentId }, _count: { _all: true } }),
    prisma.commentReaction.findUnique({
      where: { commentId_authorId: { commentId, authorId: viewerId } },
      select: { type: true },
    }),
  ]);

  const counts: ReactionCounts = {};
  for (const group of grouped) {
    if (isReactionType(group.type)) {
      counts[group.type] = group._count._all;
    }
  }

  return { counts, mine: mine && isReactionType(mine.type) ? mine.type : null };
}

/** Compteurs et réaction de l'utilisateur pour un article. */
async function articleReactionState(articleId: string, viewerId: string): Promise<ReactionState> {
  const [grouped, mine] = await Promise.all([
    prisma.articleReaction.groupBy({ by: ["type"], where: { articleId }, _count: { _all: true } }),
    prisma.articleReaction.findUnique({
      where: { articleId_authorId: { articleId, authorId: viewerId } },
      select: { type: true },
    }),
  ]);

  const counts: ReactionCounts = {};
  for (const group of grouped) {
    if (isReactionType(group.type)) {
      counts[group.type] = group._count._all;
    }
  }

  return { counts, mine: mine && isReactionType(mine.type) ? mine.type : null };
}

/* --------------------------------------------------------------- commentaire */

/**
 * Dépôt d'un commentaire, éventuellement en réponse à un commentaire racine
 * (`parentId`, WP10d). La réponse est notifiée à l'auteur du commentaire parent,
 * sauf s'il se répond à lui-même : la création de la notification ne doit jamais
 * faire échouer le dépôt (voir `@/lib/notifications`).
 */
export async function createComment(formData: FormData): Promise<void> {
  const session = await auth();
  const slug = String(formData.get("slug") ?? "");

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/article/${slug}`)}`);
  }

  const content = String(formData.get("content") ?? "").trim();

  if (content.length === 0) {
    redirect(`/article/${slug}?commentaire=vide`);
  }
  if (!isValidCommentLength(content)) {
    redirect(`/article/${slug}?commentaire=long`);
  }

  const author = await prisma.author.findUnique({
    where: { id: session.user.id },
    select: { name: true, bannedUntil: true, banReason: true },
  });

  if (author && isBanned(author)) {
    redirect(`/article/${slug}?commentaire=banni`);
  }

  const article = await prisma.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: { id: true },
  });

  if (!article) {
    redirect(`/article/${slug}?commentaire=introuvable`);
  }

  // Le parent est validé côté serveur : il doit exister, être publié et
  // appartenir au même article. Un parent invalide est ignoré (commentaire
  // racine) plutôt que de faire échouer le dépôt.
  const rawParentId = String(formData.get("parentId") ?? "").trim();
  const parent = rawParentId
    ? await prisma.comment.findFirst({
        where: { id: rawParentId, articleId: article.id, status: "APPROVED" },
        select: { id: true, authorId: true, content: true },
      })
    : null;

  // Limitation de débit : 10 commentaires par heure et par utilisateur (WP10b).
  // Le compteur n'est consommé qu'au moment de la création effective, pour
  // qu'un commentaire vide ou trop long ne décompte pas le quota.
  const limit = consumeRateLimit(`comment:${session.user.id}`, COMMENT_RATE_LIMIT);
  if (!limit.allowed) {
    redirect(`/article/${slug}?commentaire=limite`);
  }

  await prisma.comment.create({
    data: {
      content,
      articleId: article.id,
      authorId: session.user.id,
      parentId: parent?.id ?? null,
      status: "PENDING",
    },
  });

  // WP10d : notifier l'auteur du commentaire parent (no-op sans parent ou en
  // cas d'auto-réponse).
  if (parent) {
    await notifyCommentReply({
      slug,
      parentAuthorId: parent.authorId,
      parentContent: parent.content,
      replyAuthorId: session.user.id,
      replyAuthorName: author?.name ?? "Un lecteur",
    });
  }

  revalidatePath(`/article/${slug}`);
  revalidatePath("/mon-compte/notifications");
  redirect(`/article/${slug}?commentaire=en-attente#commentaires`);
}

/* ------------------------------------------------------------------ réactions */

/**
 * Réaction sur un commentaire : crée, remplace ou retire celle de l'utilisateur
 * (un clic sur la réaction déjà posée la retire). Renvoie l'état à jour, que le
 * composant client utilise pour confirmer sa mise à jour optimiste.
 */
export async function reactToComment(
  commentId: string,
  type: ReactionType,
): Promise<EngagementResult> {
  const access = await requireViewer();
  if ("error" in access) {
    return { ok: false, error: access.error };
  }
  if (!PUBLIC_COMMENT_REACTIONS.includes(type)) {
    return { ok: false, error: "Réaction non autorisée." };
  }

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, status: "APPROVED" },
    select: { id: true, authorId: true, content: true, article: { select: { slug: true } } },
  });
  if (!comment) {
    return { ok: false, error: "Ce commentaire n'est plus disponible." };
  }

  const existing = await prisma.commentReaction.findUnique({
    where: { commentId_authorId: { commentId, authorId: access.viewer.id } },
    select: { id: true, type: true },
  });

  if (existing?.type === type) {
    await prisma.commentReaction.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.commentReaction.update({ where: { id: existing.id }, data: { type } });
  } else {
    await prisma.commentReaction.create({
      data: { commentId, authorId: access.viewer.id, type },
    });
  }

  // WP10d : on notifie l'auteur du commentaire quand une réaction est posée ou
  // remplacée, jamais quand elle est retirée (retirer n'est pas un événement
  // digne d'une alerte). Le helper écarte l'auto-notification.
  if (existing?.type !== type) {
    await notifyCommentReaction({
      slug: comment.article.slug,
      commentAuthorId: comment.authorId,
      commentContent: comment.content,
      reactorId: access.viewer.id,
      reactorName: access.viewer.name,
      reactionLabel: REACTION_LABELS[type],
    });
    revalidatePath("/mon-compte/notifications");
  }

  return { ok: true, state: await commentReactionState(commentId, access.viewer.id) };
}

/**
 * Réaction sur un article (Like, Love, Bookmark). Le Bookmark est privé : il
 * n'est compté publiquement que pour Like et Love.
 */
export async function reactToArticle(
  articleId: string,
  type: ReactionType,
): Promise<EngagementResult> {
  const access = await requireViewer();
  if ("error" in access) {
    return { ok: false, error: access.error };
  }
  if (!ARTICLE_REACTION_TYPES.includes(type)) {
    return { ok: false, error: "Réaction non autorisée." };
  }

  const article = await prisma.article.findFirst({
    where: { id: articleId, status: "PUBLISHED" },
    select: { id: true },
  });
  if (!article) {
    return { ok: false, error: "Cet article n'est plus disponible." };
  }

  const existing = await prisma.articleReaction.findUnique({
    where: { articleId_authorId: { articleId, authorId: access.viewer.id } },
    select: { id: true, type: true },
  });

  if (existing?.type === type) {
    await prisma.articleReaction.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.articleReaction.update({ where: { id: existing.id }, data: { type } });
  } else {
    await prisma.articleReaction.create({
      data: { articleId, authorId: access.viewer.id, type },
    });
  }

  return { ok: true, state: await articleReactionState(articleId, access.viewer.id) };
}

/* ---------------------------------------------------------------- signalement */

/**
 * Signalement public d'un commentaire : le signalement est créé (PENDING) et le
 * commentaire passe en FLAGGED, donc invisible publiquement, en attendant la
 * décision d'un modérateur (WP10c).
 */
export async function reportComment(
  commentId: string,
  reason: ReportReason,
  details?: string,
): Promise<EngagementResult> {
  const access = await requireViewer();
  if ("error" in access) {
    return { ok: false, error: access.error };
  }
  if (!isReportReason(reason)) {
    return { ok: false, error: "Motif de signalement invalide." };
  }

  // Le commentaire est cherché sans filtrer sur son statut : un commentaire déjà
  // masqué (FLAGGED) doit répondre « déjà signalé » à un nouvel essai du même
  // utilisateur, et non « indisponible ». Un second signalement par un autre
  // utilisateur reste possible : il enrichit le dossier de modération.
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, status: { not: "DELETED" } },
    select: { id: true, authorId: true, status: true },
  });
  if (!comment) {
    return { ok: false, error: "Ce commentaire n'est plus disponible." };
  }
  if (comment.authorId === access.viewer.id) {
    return { ok: false, error: "Vous ne pouvez pas signaler votre propre commentaire." };
  }

  const already = await prisma.report.findUnique({
    where: { commentId_reporterId: { commentId, reporterId: access.viewer.id } },
    select: { id: true },
  });
  if (already) {
    return { ok: false, error: "Vous avez déjà signalé ce commentaire." };
  }

  const trimmed = details?.trim();

  try {
    await prisma.$transaction([
      prisma.report.create({
        data: {
          commentId,
          reporterId: access.viewer.id,
          reason,
          details: trimmed && trimmed.length > 0 ? trimmed.slice(0, 500) : null,
          status: "PENDING",
        },
      }),
      prisma.comment.update({ where: { id: commentId }, data: { status: "FLAGGED" } }),
    ]);
  } catch {
    // Contrainte d'unicité (course entre deux clics) : le signalement existe déjà.
    return { ok: false, error: "Vous avez déjà signalé ce commentaire." };
  }

  return { ok: true };
}
