"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  banUntilFromDuration,
  isBanDuration,
  type CommentStatus,
} from "@/lib/engagement";
import { formatDate } from "@/lib/formatDate";
import { notifyCommentModerated, notifyReportHandled, notifyUserBanned, notifyUserUnbanned } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

/**
 * Server Actions de modération (WP10c).
 *
 * Toutes les actions sont réservées aux ADMIN : la vérification est faite ici,
 * et pas seulement dans la page, car une Server Action est un point d'entrée
 * HTTP à part entière.
 *
 * Deux formes de signatures coexistent, volontairement :
 *  - les actions à cible unique reçoivent l'identifiant (`approveComment(id)`) et
 *    sont liées dans les formulaires par `.bind(null, id)` ;
 *  - les actions groupées et le bannissement lisent un `FormData`, parce que
 *    c'est la seule façon de transporter une sélection de cases à cocher et les
 *    champs d'un formulaire sans JavaScript côté client.
 *
 * Aucun journal d'audit n'est tenu : c'est prévu hors de ce lot (WP13+).
 */

const ADMIN_PATH = "/backoffice/comments";

/** Vérifie la session et le rôle ; redirige sinon (renvoie l'auteur courant). */
async function requireAdmin(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }
  return { id: session.user.id ?? "" };
}

/** Identifiants cochés dans un formulaire de sélection multiple. */
function selectedIds(formData: FormData): string[] {
  return formData
    .getAll("ids")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

/**
 * Applique un statut de modération à un commentaire.
 *
 * WP10d : une approbation ou un rejet notifie l'auteur du commentaire (une
 * suppression douce reste silencieuse, et aucune notification n'est envoyée si
 * le statut ne change pas réellement). Les actions groupées ne notifient pas :
 * `setCommentStatusMany` les traite en masse, sans alerte individuelle.
 */
async function setCommentStatus(id: string, status: CommentStatus): Promise<void> {
  await requireAdmin();

  const comment = await prisma.comment.findUnique({
    where: { id },
    select: {
      authorId: true,
      content: true,
      status: true,
      article: { select: { slug: true } },
    },
  });

  if (!comment) {
    revalidatePath(ADMIN_PATH);
    return;
  }

  await prisma.comment.update({ where: { id }, data: { status } });

  if (comment.status !== status && (status === "APPROVED" || status === "REJECTED")) {
    await notifyCommentModerated({
      slug: comment.article.slug,
      commentAuthorId: comment.authorId,
      commentContent: comment.content,
      approved: status === "APPROVED",
    });
    revalidatePath("/mon-compte/notifications");
  }

  revalidatePath(ADMIN_PATH);
}

/** Applique un statut de modération à plusieurs commentaires d'un coup. */
async function setCommentStatusMany(ids: string[], status: CommentStatus): Promise<void> {
  await requireAdmin();
  if (ids.length === 0) {
    // Rien de coché : on ne touche à rien, sans erreur pour l'utilisateur.
    revalidatePath(ADMIN_PATH);
    return;
  }
  await prisma.comment.updateMany({ where: { id: { in: ids } }, data: { status } });
  revalidatePath(ADMIN_PATH);
}

/* ------------------------------------------------- commentaires (individuel) */

/** Approuve un commentaire : il devient visible publiquement. */
export async function approveComment(id: string): Promise<void> {
  await setCommentStatus(id, "APPROVED");
}

/** Rejette un commentaire : il reste invisible publiquement. */
export async function rejectComment(id: string): Promise<void> {
  await setCommentStatus(id, "REJECTED");
}

/** Suppression douce : le contenu est conservé pour l'audit. */
export async function deleteComment(id: string): Promise<void> {
  await setCommentStatus(id, "DELETED");
}

/* -------------------------------------------------- commentaires (groupées) */

/**
 * Aiguillage d'une ligne du tableau : un formulaire HTML ne porte qu'une seule
 * action, donc les trois boutons (Approuver / Rejeter / Supprimer) envoient
 * `intent` et cette action délègue aux actions individuelles ci-dessus.
 */
export async function moderateComment(commentId: string, formData: FormData): Promise<void> {
  const intent = formData.get("intent");
  if (intent === "reject") {
    await rejectComment(commentId);
    return;
  }
  if (intent === "delete") {
    await deleteComment(commentId);
    return;
  }
  await approveComment(commentId);
}

export async function bulkApprove(formData: FormData): Promise<void> {
  await setCommentStatusMany(selectedIds(formData), "APPROVED");
}

export async function bulkReject(formData: FormData): Promise<void> {
  await setCommentStatusMany(selectedIds(formData), "REJECTED");
}

export async function bulkDelete(formData: FormData): Promise<void> {
  await setCommentStatusMany(selectedIds(formData), "DELETED");
}

/**
 * Aiguillage des actions groupées.
 *
 * Un formulaire HTML ne peut porter qu'une seule action : la barre de sélection
 * envoie donc `intent` (nom du bouton cliqué) et cette action délègue aux trois
 * actions groupées ci-dessus, qui restent utilisables séparément.
 */
export async function bulkModerate(formData: FormData): Promise<void> {
  const intent = formData.get("intent");
  if (intent === "reject") {
    await bulkReject(formData);
    return;
  }
  if (intent === "delete") {
    await bulkDelete(formData);
    return;
  }
  await bulkApprove(formData);
}

/* ------------------------------------------------------------- signalements */

/**
 * Résout un signalement : le signalement passe à RESOLVED (avec sa date et son
 * auteur) et le commentaire visé est rejeté.
 *
 * WP10d : le signalant est informé que son signalement a été traité, et l'auteur
 * du commentaire retiré reçoit la même alerte de modération qu'un rejet manuel.
 */
export async function resolveReport(id: string): Promise<void> {
  const admin = await requireAdmin();

  const report = await prisma.report.findUnique({
    where: { id },
    select: {
      commentId: true,
      reporterId: true,
      comment: {
        select: { authorId: true, content: true, article: { select: { slug: true } } },
      },
    },
  });
  if (!report) {
    revalidatePath(ADMIN_PATH);
    return;
  }

  await prisma.$transaction([
    prisma.report.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: admin.id },
    }),
    prisma.comment.update({ where: { id: report.commentId }, data: { status: "REJECTED" } }),
  ]);

  const slug = report.comment.article.slug;
  await Promise.all([
    notifyReportHandled({ slug, reporterId: report.reporterId, resolved: true }),
    notifyCommentModerated({
      slug,
      commentAuthorId: report.comment.authorId,
      commentContent: report.comment.content,
      approved: false,
    }),
  ]);
  revalidatePath("/mon-compte/notifications");

  revalidatePath(ADMIN_PATH);
}

/** Rejette un signalement : le commentaire n'est pas modifié. */
export async function dismissReport(id: string): Promise<void> {
  await requireAdmin();

  const report = await prisma.report.findUnique({
    where: { id },
    select: { reporterId: true, comment: { select: { article: { select: { slug: true } } } } },
  });

  await prisma.report.update({
    where: { id },
    data: { status: "DISMISSED", resolvedAt: new Date(), resolvedById: null },
  });

  // WP10d : le signalant sait que son signalement a été examiné et classé.
  if (report) {
    await notifyReportHandled({
      slug: report.comment.article.slug,
      reporterId: report.reporterId,
      resolved: false,
    });
    revalidatePath("/mon-compte/notifications");
  }

  revalidatePath(ADMIN_PATH);
}

/**
 * Supprime le commentaire visé par un signalement (suppression douce) tout en
 * laissant le signalement à traiter.
 */
export async function deleteReportedComment(reportId: string): Promise<void> {
  await requireAdmin();
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { commentId: true },
  });
  if (!report) {
    revalidatePath(ADMIN_PATH);
    return;
  }
  await prisma.comment.update({ where: { id: report.commentId }, data: { status: "DELETED" } });
  revalidatePath(ADMIN_PATH);
}

/* ------------------------------------------------- signalements : ligne */

/**
 * Aiguillage d'une ligne de signalement : Résoudre / Rejeter / Supprimer le
 * commentaire, selon le bouton cliqué (`intent`).
 */
export async function moderateReport(reportId: string, formData: FormData): Promise<void> {
  const intent = formData.get("intent");
  if (intent === "dismiss") {
    await dismissReport(reportId);
    return;
  }
  if (intent === "delete") {
    await deleteReportedComment(reportId);
    return;
  }
  await resolveReport(reportId);
}

/* ------------------------------------------------------------ bannissements */
/**
 * Bannit un auteur : `duration` et `reason` viennent du formulaire modal.
 * Un bannissement permanent est stocké comme une date très lointaine.
 * WP10d : l'intéressé reçoit une notification in-app (aucun e-mail dans ce lot).
 */
export async function banUser(userId: string, formData: FormData): Promise<void> {
  await requireAdmin();

  const duration = formData.get("duration");
  const reason = formData.get("reason");
  const label = isBanDuration(duration) ? duration : "7d";

  const bannedUntil = banUntilFromDuration(label);
  const trimmedReason =
    typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;

  await prisma.author.update({
    where: { id: userId },
    data: { bannedUntil, banReason: trimmedReason },
  });

  // La date de fin est affichée en clair dans le message ; un bannissement
  // permanent n'a pas de date lisible, on transmet donc `null`.
  await notifyUserBanned({
    userId,
    untilLabel: label === "permanent" ? null : formatDate(bannedUntil),
    reason: trimmedReason,
  });
  revalidatePath("/mon-compte/notifications");

  revalidatePath(ADMIN_PATH);
}

/** Lève un bannissement : les deux champs sont effacés. */
export async function unbanUser(userId: string): Promise<void> {
  await requireAdmin();
  await prisma.author.update({
    where: { id: userId },
    data: { bannedUntil: null, banReason: null },
  });

  await notifyUserUnbanned({ userId });
  revalidatePath("/mon-compte/notifications");

  revalidatePath(ADMIN_PATH);
}
