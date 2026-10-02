import type { Prisma } from "@/generated/prisma/client";
import {
  renderCommentApprovedEmail,
  renderCommentRejectedEmail,
  renderCommentReplyEmail,
  renderReportResolvedEmail,
  renderUserBannedEmail,
  type EmailContent,
  type NotificationEmailData,
  type NotificationRecipient,
} from "@/lib/email-templates";
import {
  NOTIFICATION_EMAIL_RATE_LIMIT,
  consumeRateLimit,
  notificationEmailRateLimitMessage,
} from "@/lib/rate-limit";
import { sendEmail, type SendEmailResult } from "@/lib/resend";

/**
 * Notifications par e-mail (WP11e).
 *
 * Chaque notification in-app peut donner lieu à un e-mail, selon deux niveaux de
 * préférence : un interrupteur global et une liste de types désactivés. L'envoi
 * est **best-effort** : il ne fait jamais échouer l'action qui l'a déclenché
 * (dépôt d'un commentaire, modération, bannissement), et il est plafonné à
 * 20 messages par heure et par utilisateur.
 *
 * Deux types restent volontairement in-app : COMMENT_REACTION (« trop bruyant »
 * pour le brief) et les notifications de signalement classé / de fin de
 * suspension, qui n'ont pas de gabarit dédié.
 */

/** Types de notification qui peuvent partir par e-mail (brief WP11e). */
export const EMAIL_NOTIFICATION_TYPES = [
  "COMMENT_REPLY",
  "COMMENT_APPROVED",
  "COMMENT_REJECTED",
  "USER_BANNED",
  "REPORT_RESOLVED",
] as const;

export type EmailNotificationType = (typeof EMAIL_NOTIFICATION_TYPES)[number];

/** Libellés des cases de la page de préférences. */
export const EMAIL_NOTIFICATION_LABELS: Record<EmailNotificationType, { label: string; hint: string }> = {
  COMMENT_REPLY: {
    label: "Réponse à mon commentaire",
    hint: "Quelqu'un répond à l'un de vos commentaires.",
  },
  COMMENT_APPROVED: {
    label: "Commentaire approuvé",
    hint: "Votre commentaire est publié après modération.",
  },
  COMMENT_REJECTED: {
    label: "Commentaire refusé",
    hint: "La modération n'a pas retenu votre commentaire.",
  },
  USER_BANNED: {
    label: "Suspension de mon compte",
    hint: "Votre compte est suspendu (commentaires et réactions).",
  },
  REPORT_RESOLVED: {
    label: "Signalement traité",
    hint: "La modération a statué sur un contenu que vous avez signalé.",
  },
};

export function isEmailNotificationType(value: unknown): value is EmailNotificationType {
  return (
    typeof value === "string" && (EMAIL_NOTIFICATION_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Types désactivés stockés sur le compte.
 *
 * La colonne est un `Json?` : on ne fait pas confiance à son contenu (valeur
 * historique, écriture manuelle dans Prisma Studio) et on ne retient que les
 * chaînes connues.
 */
export function disabledTypes(value: Prisma.JsonValue | null | undefined): EmailNotificationType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isEmailNotificationType);
}

export type NotificationPreferenceUser = {
  emailNotificationsEnabled: boolean;
  emailNotificationTypes: Prisma.JsonValue | null;
};

/**
 * Vrai si un e-mail doit partir pour ce type de notification : interrupteur
 * global actif, type concerné par l'e-mail, et type non désactivé.
 */
export function shouldSendEmail(
  user: NotificationPreferenceUser,
  notificationType: string,
): notificationType is EmailNotificationType {
  if (!user.emailNotificationsEnabled) {
    return false;
  }
  if (!isEmailNotificationType(notificationType)) {
    return false;
  }
  return !disabledTypes(user.emailNotificationTypes).includes(notificationType);
}

/** Gabarit correspondant au type de notification. */
function renderFor(
  type: EmailNotificationType,
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
): EmailContent {
  switch (type) {
    case "COMMENT_REPLY":
      return renderCommentReplyEmail(notification, recipient);
    case "COMMENT_APPROVED":
      return renderCommentApprovedEmail(notification, recipient);
    case "COMMENT_REJECTED":
      return renderCommentRejectedEmail(notification, recipient);
    case "USER_BANNED":
      return renderUserBannedEmail(notification, recipient);
    case "REPORT_RESOLVED":
    default:
      return renderReportResolvedEmail(notification, recipient);
  }
}

/** Objet de la ligne « Sujet » selon le type. */
const SUBJECTS: Record<EmailNotificationType, string> = {
  COMMENT_REPLY: "Quelqu'un a répondu à votre commentaire",
  COMMENT_APPROVED: "Votre commentaire a été approuvé",
  COMMENT_REJECTED: "Votre commentaire a été rejeté",
  USER_BANNED: "Vous avez été banni",
  REPORT_RESOLVED: "Votre signalement a été traité",
};

export type NotificationEmailInput = {
  /** Notification in-app qui vient d'être créée. */
  notification: NotificationEmailData & { id: string; type: string };
  /** Destinataire : identifiant + adresse et nom affiché. */
  user: NotificationRecipient & { id: string };
};

/**
 * Envoie l'e-mail correspondant à une notification.
 *
 * **Ne lève jamais** : toute erreur est journalisée et renvoyée dans le résultat.
 * L'appelant l'invoque sans l'attendre (`void`), pour que l'action métier ne
 * dépende pas de la disponibilité du fournisseur d'e-mail.
 */
export async function sendNotificationEmail({
  notification,
  user,
}: NotificationEmailInput): Promise<SendEmailResult> {
  if (!isEmailNotificationType(notification.type)) {
    return { success: false, error: "Type de notification sans e-mail." };
  }

  // Plafond horaire, par utilisateur : au-delà, la notification in-app reste
  // créée mais l'e-mail est abandonné.
  const limit = consumeRateLimit(`notif-email:${user.id}`, NOTIFICATION_EMAIL_RATE_LIMIT);
  if (!limit.allowed) {
    const reason = notificationEmailRateLimitMessage(limit.retryAfterMs);
    console.warn(`[notification-email] ${user.email} : ${reason}`);
    return { success: false, error: reason };
  }

  try {
    const content = renderFor(
      notification.type,
      {
        title: notification.title,
        message: notification.message,
        linkUrl: notification.linkUrl,
      },
      { email: user.email, name: user.name },
    );

    return await sendEmail({
      to: user.email,
      subject: SUBJECTS[notification.type],
      html: content.html,
      text: content.text,
      // Ces e-mails ne sont pas mesurables (pas de pixel), mais l'étiquette
      // permet de retrouver leur origine dans les journaux Resend.
      tags: [
        { name: "notification_id", value: notification.id },
        { name: "notification_type", value: notification.type },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "erreur inconnue";
    console.warn(`[notification-email] envoi impossible pour ${user.email} : ${message}`);
    return { success: false, error: message };
  }
}
