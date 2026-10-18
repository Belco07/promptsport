import { Prisma, type NotificationType } from "@/generated/prisma/client";
import { commentExcerpt } from "@/lib/engagement";
import { sendNotificationEmail, shouldSendEmail } from "@/lib/notification-email";
import { prisma } from "@/lib/prisma";

function clubText(text: string): string {
  return ` ${text.replace(/<[^>]*>/g, " ").toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/** Publication callbacks share a lock and never send individual alert emails. */
export async function notifyArticleFollowers(articleId: string): Promise<void> {
  try {
    await prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`article-follow:${articleId}`}))`;
      const article = await db.article.findUnique({ where: { id: articleId }, select: { title: true, content: true, slug: true, status: true, publishedAt: true, authorId: true, match: { select: { homeTeamId: true, awayTeamId: true } } } });
      if (!article || article.status !== "PUBLISHED" || !article.publishedAt || article.publishedAt > new Date()) return;
      const clubs = await db.team.findMany({ select: { id: true, name: true, shortName: true } });
      const text = clubText(`${article.title} ${article.content}`);
      const ids = clubs.filter(club => club.id === article.match?.homeTeamId || club.id === article.match?.awayTeamId || [club.name, club.shortName].some(term => term && clubText(term).trim().length >= 3 && text.includes(clubText(term)))).map(club => club.id);
      if (!ids.length) return;
      const linkUrl = `/article/${article.slug}`;
      const readers = await db.author.findMany({ where: {
        alertsEnabled: true, id: { not: article.authorId },
        OR: [{ followedTeams: { some: { id: { in: ids } } } }, { favoriteClubId: { in: ids } }],
        notifications: { none: { type: "ARTICLE_PUBLISHED", linkUrl } },
      }, select: { id: true } });
      if (readers.length) await db.notification.createMany({ data: readers.map(reader => ({ userId: reader.id, type: "ARTICLE_PUBLISHED", title: "Du nouveau sur vos clubs", message: article.title.slice(0, 300), linkUrl })) });
    });
  } catch (error) {
    console.warn("[club-alerts] Notification impossible", error instanceof Error ? error.message : "Erreur inconnue");
  }
}

export const CLUB_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Whole phrases: Inter must not match Interview. No premium content leaves SQL. */
export async function getClubAlertContent(clubIds: string[], now = new Date(), db: Pick<Prisma.TransactionClient, "$queryRaw" | "match"> = prisma) {
  if (!clubIds.length) return { articles: [], matches: [] };
  const cutoff = new Date(now.getTime() - CLUB_ALERT_WINDOW_MS);
  const articles = await db.$queryRaw<{ id: string; title: string; slug: string }[]>(Prisma.sql`
    SELECT a.id, a.title, a.slug FROM "Article" a
    LEFT JOIN "Match" m ON m.id = a."matchId"
    WHERE a.status = 'PUBLISHED' AND a."publishedAt" >= ${cutoff} AND a."publishedAt" <= ${now}
      AND (m."homeTeamId" IN (${Prisma.join(clubIds)}) OR m."awayTeamId" IN (${Prisma.join(clubIds)})
        OR EXISTS (SELECT 1 FROM "Team" t
          CROSS JOIN LATERAL (VALUES(t.name), (t."shortName")) term(value)
          WHERE t.id IN (${Prisma.join(clubIds)}) AND length(trim(term.value)) >= 3
            AND strpos(' ' || trim(regexp_replace(lower(regexp_replace(a.title || ' ' || a.content, '<[^>]*>', ' ', 'g')), '[^[:alnum:]]+', ' ', 'g')) || ' ',
              ' ' || trim(regexp_replace(lower(term.value), '[^[:alnum:]]+', ' ', 'g')) || ' ') > 0))
    ORDER BY a."publishedAt" DESC, a.id DESC LIMIT 5
  `);
  const matches = await db.match.findMany({ where: { createdAt: { gte: cutoff, lte: now }, OR: [{ homeTeamId: { in: clubIds } }, { awayTeamId: { in: clubIds } }], status: { not: "CANCELLED" } }, select: { id: true, status: true, scheduledAt: true, homeScore: true, awayScore: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } }, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 5 });
  return { articles, matches };
}

/** Serializes concurrent CLI runs; failed/uncertain sends also consume the slot. */
export async function reserveClubAlert(readerId: string, now = new Date()) {
  return prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`club-alert:${readerId}`}))`;
    const reader = await db.author.findUnique({ where: { id: readerId }, select: { id: true, name: true, email: true, alertsEnabled: true, emailNotificationsEnabled: true, bannedUntil: true, followedTeams: { select: { id: true, name: true } }, favoriteClub: { select: { id: true, name: true } } } });
    if (!reader?.alertsEnabled || !reader.emailNotificationsEnabled || (reader.bannedUntil && reader.bannedUntil > now)) return null;
    if (await db.clubAlertDelivery.findFirst({ where: { readerId, createdAt: { gt: new Date(now.getTime() - CLUB_ALERT_WINDOW_MS) } }, select: { id: true } })) return null;
    const clubs = [...new Map([...reader.followedTeams, ...(reader.favoriteClub ? [reader.favoriteClub] : [])].map(club => [club.id, club])).values()];
    const content = await getClubAlertContent(clubs.map(club => club.id), now, db);
    if (!content.articles.length && !content.matches.length) return null;
    const delivery = await db.clubAlertDelivery.create({ data: { readerId, createdAt: now }, select: { id: true } });
    return { deliveryId: delivery.id, reader, clubs, ...content };
  });
}

/**
 * Notifications in-app (WP10d), doublées d'un e-mail depuis le WP11e.
 *
 * Trois principes :
 *  - **échec silencieux** : une notification qui n'a pas pu être créée ne doit
 *    jamais faire échouer l'action principale (dépôt d'un commentaire, réaction,
 *    modération…). Les helpers attrapent donc leurs erreurs et renvoient `false`.
 *  - **pas d'auto-notification** : on ne notifie pas quelqu'un de sa propre
 *    action (répondre à son commentaire, réagir à soi-même).
 *  - **l'e-mail ne bloque jamais** : il part après la création de la notification,
 *    sans être attendu (`void …`), et seulement si le destinataire l'a autorisé
 *    (interrupteur global + type non désactivé). Un fournisseur indisponible
 *    laisse la notification in-app intacte.
 */

export type NotificationInput = {
  /** Destinataire. */
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  /** Lien interne vers la ressource concernée. */
  linkUrl?: string | null;
};

/** Longueur de l'extrait d'un commentaire cité dans une notification. */
const QUOTE_LENGTH = 80;

/**
 * Crée une notification. Renvoie `true` si elle a été enregistrée, `false` en
 * cas d'échec : l'appelant n'a rien à faire de plus, l'erreur est journalisée
 * sans interrompre le parcours utilisateur.
 *
 * L'e-mail éventuel est déclenché **après** l'écriture, sans `await` : la Server
 * Action qui répond à un commentaire ne doit pas attendre le fournisseur.
 */
export async function createNotification(input: NotificationInput): Promise<boolean> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        linkUrl: input.linkUrl ?? null,
      },
      select: { id: true, userId: true, type: true, title: true, message: true, linkUrl: true },
    });

    void notifyByEmail(notification).catch((error) => {
      console.warn(
        "[notifications] e-mail impossible :",
        error instanceof Error ? error.message : error,
      );
    });

    return true;
  } catch (error) {
    console.warn(
      "[notifications] création impossible :",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Envoie l'e-mail de la notification si les préférences du destinataire
 * l'autorisent. Le compte est relu ici : `createNotification` ne connaît que
 * l'identifiant, et la lecture n'a lieu que pour les types concernés par
 * l'e-mail.
 */
async function notifyByEmail(notification: {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl: string | null;
}): Promise<void> {
  const user = await prisma.author.findUnique({
    where: { id: notification.userId },
    select: {
      id: true,
      email: true,
      name: true,
      emailNotificationsEnabled: true,
      emailNotificationTypes: true,
    },
  });
  if (!user) {
    return;
  }
  if (!shouldSendEmail(user, notification.type)) {
    return;
  }

  await sendNotificationEmail({
    notification: {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      linkUrl: notification.linkUrl,
    },
    user: { id: user.id, email: user.email, name: user.name },
  });
}

/** Lien vers la section de commentaires d'un article. */
function commentsLink(slug: string): string {
  return `/article/${slug}#commentaires`;
}

/**
 * Réponse au commentaire de quelqu'un : le destinataire est l'auteur du
 * commentaire parent. Sans parent, ou si l'on se répond à soi-même, rien n'est
 * créé.
 */
export async function notifyCommentReply(input: {
  slug: string;
  parentAuthorId: string;
  parentContent: string;
  replyAuthorId: string;
  replyAuthorName: string;
}): Promise<boolean> {
  if (input.parentAuthorId === input.replyAuthorId) {
    return false;
  }

  return createNotification({
    userId: input.parentAuthorId,
    type: "COMMENT_REPLY",
    title: "Nouvelle réponse à votre commentaire",
    message: `${input.replyAuthorName} a répondu à votre commentaire « ${commentExcerpt(
      input.parentContent,
      QUOTE_LENGTH,
    )} ».`,
    linkUrl: commentsLink(input.slug),
  });
}

/**
 * Réaction sur le commentaire de quelqu'un : le destinataire est l'auteur du
 * commentaire. Une réaction sur son propre commentaire ne notifie personne.
 */
export async function notifyCommentReaction(input: {
  slug: string;
  commentAuthorId: string;
  commentContent: string;
  reactorId: string;
  reactorName: string;
  reactionLabel: string;
}): Promise<boolean> {
  if (input.commentAuthorId === input.reactorId) {
    return false;
  }

  return createNotification({
    userId: input.commentAuthorId,
    type: "COMMENT_REACTION",
    title: "Nouvelle réaction à votre commentaire",
    message: `${input.reactorName} a réagi « ${input.reactionLabel} » à votre commentaire « ${commentExcerpt(
      input.commentContent,
      QUOTE_LENGTH,
    )} ».`,
    linkUrl: commentsLink(input.slug),
  });
}

/* ------------------------------------------------------- modération (WP10c) */

/** Décision de modération sur le commentaire de quelqu'un. */
export async function notifyCommentModerated(input: {
  slug: string;
  commentAuthorId: string;
  commentContent: string;
  approved: boolean;
}): Promise<boolean> {
  return createNotification({
    userId: input.commentAuthorId,
    type: input.approved ? "COMMENT_APPROVED" : "COMMENT_REJECTED",
    title: input.approved ? "Votre commentaire est publié" : "Votre commentaire a été refusé",
    message: input.approved
      ? `Votre commentaire « ${commentExcerpt(input.commentContent, QUOTE_LENGTH)} » a été approuvé et est désormais visible.`
      : `Votre commentaire « ${commentExcerpt(input.commentContent, QUOTE_LENGTH)} » n'a pas été retenu par la modération.`,
    linkUrl: commentsLink(input.slug),
  });
}

/** Suite donnée au signalement déposé par quelqu'un. */
export async function notifyReportHandled(input: {
  slug: string;
  reporterId: string;
  resolved: boolean;
}): Promise<boolean> {
  return createNotification({
    userId: input.reporterId,
    type: input.resolved ? "REPORT_RESOLVED" : "REPORT_DISMISSED",
    title: input.resolved ? "Votre signalement a été traité" : "Votre signalement a été classé",
    message: input.resolved
      ? "Merci : le commentaire que vous avez signalé a été retiré par la modération."
      : "Le commentaire que vous avez signalé a été examiné et conservé par la modération.",
    linkUrl: commentsLink(input.slug),
  });
}

/**
 * Bannissement d'un compte. `untilLabel` vaut `null` pour un bannissement
 * permanent : le message ne peut pas dire « jusqu'au … » dans ce cas.
 */
export async function notifyUserBanned(input: {
  userId: string;
  untilLabel: string | null;
  reason: string | null;
}): Promise<boolean> {
  const deadline = input.untilLabel
    ? `Vous ne pouvez plus commenter ni réagir jusqu'au ${input.untilLabel}.`
    : "Vous ne pouvez plus commenter ni réagir : la suspension est définitive.";

  return createNotification({
    userId: input.userId,
    type: "USER_BANNED",
    title: "Votre compte est suspendu",
    message: `${deadline} Raison : ${input.reason?.trim() || "non précisée"}.`,
  });
}

/** Fin d'un bannissement. */
export async function notifyUserUnbanned(input: { userId: string }): Promise<boolean> {
  return createNotification({
    userId: input.userId,
    type: "USER_UNBANNED",
    title: "Votre compte est de nouveau actif",
    message: "Votre suspension a été levée : vous pouvez à nouveau commenter et réagir.",
  });
}
