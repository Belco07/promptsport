import { absoluteUrl } from "@/lib/seo";

/**
 * Templates des e-mails de newsletter (WP11b).
 *
 * Trois règles, dictées par les clients de messagerie :
 *
 *  1. **styles en ligne** uniquement (`style="…"`) : Gmail, Outlook et consorts
 *     ignorent les feuilles de style externes, et Tailwind n'existe pas dans un
 *     e-mail ;
 *  2. **tables et largeurs fixes** : le HTML d'e-mail reste un monde à part, une
 *     mise en page en `div` flexbox se casse dans Outlook ;
 *  3. **échappement des valeurs venant de l'abonné** (nom, adresse) : le corps de
 *     la campagne, lui, est du HTML rédigé par un administrateur et volontairement
 *     injecté tel quel.
 *
 * Chaque e-mail contient une version texte brut : c'est un critère de
 * délivrabilité, pas un ornement.
 */

/** Échappement HTML des valeurs saisies par un utilisateur. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Version texte brut d'un contenu HTML : balises retirées, entités défaites. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const COLOURS = {
  ink: "#0f172a",
  body: "#334155",
  muted: "#64748b",
  accent: "#df1830",
  border: "#e2e8f0",
  background: "#f1f5f9",
};

/** Gabarit commun : pré-en-tête caché, bandeau, contenu, pied de page légal. */
function layout({
  title,
  previewText,
  contentHtml,
  footerHtml,
}: {
  title: string;
  previewText?: string | null;
  contentHtml: string;
  footerHtml: string;
}): string {
  const preview = previewText
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(
        previewText,
      )}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOURS.background};">
${preview}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOURS.background};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:#ffffff;border:1px solid ${COLOURS.border};border-radius:8px;">
        <tr>
          <td style="padding:20px 28px;border-bottom:1px solid ${COLOURS.border};">
            <span style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:${COLOURS.ink};">Mon Site d'Actualités</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:${COLOURS.body};">
${contentHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px;border-top:1px solid ${COLOURS.border};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${COLOURS.muted};">
${footerHtml}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Bouton d'action, en tableau pour résister à Outlook. */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td style="background-color:${COLOURS.accent};border-radius:6px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(
        label,
      )}</a>
    </td>
  </tr>
</table>`;
}

export type EmailContent = { html: string; text: string };

/** Données de campagne nécessaires au rendu. */
export type CampaignEmailData = {
  subject: string;
  previewText: string | null;
  contentHtml: string;
  contentText: string | null;
};

/** Données d'abonné nécessaires au rendu. */
export type SubscriberEmailData = {
  email: string;
  name: string | null;
};

/**
 * E-mail de campagne : contenu de la campagne, lien de désabonnement unique et
 * pixel de suivi d'ouverture.
 *
 * Les liens de la campagne passent par le suivi de clics de Resend, activé côté
 * fournisseur : rien à faire ici.
 */
export function renderCampaignEmail(
  campaign: CampaignEmailData,
  subscriber: SubscriberEmailData,
  urls: { unsubscribeUrl: string; trackingPixelUrl: string },
): EmailContent {
  const greeting = subscriber.name
    ? `<p style="margin:0 0 16px;">Bonjour ${escapeHtml(subscriber.name)},</p>`
    : "";

  const contentHtml = `${greeting}${campaign.contentHtml}`;

  const footerHtml = `Vous recevez cet e-mail parce que vous êtes inscrit à la newsletter.
<a href="${escapeHtml(
    urls.unsubscribeUrl,
  )}" style="color:${COLOURS.muted};text-decoration:underline;">Se désabonner</a>.<br />
Pourquoi cet e-mail : inscription depuis le site Mon Site d'Actualités.`;
  // Le pixel est un simple <img> de 1×1 : les clients qui bloquent les images ne
  // remontent pas d'ouverture, les webhooks Resend restent la source principale.
  const pixel = `<img src="${escapeHtml(
    urls.trackingPixelUrl,
  )}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0;" />`;

  return {
    html: layout({
      title: campaign.subject,
      previewText: campaign.previewText,
      contentHtml,
      footerHtml: `${footerHtml}${pixel}`,
    }),
    text: `${
      subscriber.name ? `Bonjour ${subscriber.name},\n\n` : ""
    }${campaign.contentText ?? htmlToText(campaign.contentHtml)}\n\nSe désabonner : ${urls.unsubscribeUrl}\n`,
  };
}

/** E-mail de confirmation d'inscription (double opt-in). */
export function renderConfirmationEmail(
  subscriber: SubscriberEmailData,
  token: string,
): EmailContent {
  const confirmUrl = absoluteUrl(`/newsletter/confirm/${token}`);
  const greeting = subscriber.name ? `Bonjour ${escapeHtml(subscriber.name)},` : "Bonjour,";
  const contentHtml = `<p style="margin:0 0 16px;">${greeting}</p>
<p style="margin:0 0 16px;">Vous venez de demander à recevoir la newsletter de Mon Site d'Actualités. Il reste une étape : confirmez votre inscription.</p>
${button(confirmUrl, "Confirmer mon inscription")}
<p style="margin:0;color:${COLOURS.muted};font-size:13px;">Si vous n'êtes pas à l'origine de cette demande, ignorez simplement ce message : sans confirmation, aucune newsletter ne vous sera envoyée.</p>`;

  return {
    html: layout({
      title: "Confirmez votre inscription à la newsletter",
      contentHtml,
      footerHtml: `Lien de confirmation : ${escapeHtml(confirmUrl)}`,
    }),
    text: `${subscriber.name ? `Bonjour ${subscriber.name},\n\n` : "Bonjour,\n\n"}Confirmez votre inscription à la newsletter :\n${confirmUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n`,
  };
}

/** E-mail de bienvenue, envoyé après confirmation. */
export function renderWelcomeEmail(subscriber: SubscriberEmailData): EmailContent {
  const greeting = subscriber.name ? `Bonjour ${escapeHtml(subscriber.name)},` : "Bonjour,";
  const contentHtml = `<p style="margin:0 0 16px;">${greeting}</p>
<p style="margin:0 0 16px;">Votre inscription à la newsletter est confirmée : merci, et bienvenue.</p>
<p style="margin:0;">Vous recevrez nos analyses et nos résultats. Chaque e-mail contient un lien de désabonnement, en un clic.</p>`;

  return {
    html: layout({
      title: "Bienvenue dans la newsletter !",
      contentHtml,
      footerHtml: "Vous pouvez vous désabonner à tout moment depuis n'importe quel e-mail reçu.",
    }),
    text: `${subscriber.name ? `Bonjour ${subscriber.name},\n\n` : "Bonjour,\n\n"}Votre inscription à la newsletter est confirmée : merci, et bienvenue.\n`,
  };
}

/* ------------------------------------------------- notifications (WP11e) */

/**
 * E-mails des notifications automatiques.
 *
 * Chacun reprend le texte de la notification in-app, pointe vers la ressource
 * concernée, propose la page des notifications et — conformément au brief — un
 * lien vers les préférences, qui sert aussi de désabonnement.
 *
 * Aucun pixel de suivi : ces e-mails transactionnels ne sont pas mesurés.
 */

export type NotificationEmailData = {
  title: string;
  message: string;
  /** Lien interne vers la ressource concernée, s'il y en a un. */
  linkUrl: string | null;
};

export type NotificationRecipient = {
  email: string;
  name: string | null;
};

/** Pied de page commun : notifications, préférences, désabonnement. */
function notificationFooter(): string {
  const notificationsUrl = absoluteUrl("/mon-compte/notifications");
  const preferencesUrl = absoluteUrl("/mon-compte/preferences");
  return `Vous recevez ce message parce qu'une activité concerne votre compte.
<a href="${escapeHtml(notificationsUrl)}" style="color:${COLOURS.muted};text-decoration:underline;">Voir toutes mes notifications</a> ·
<a href="${escapeHtml(preferencesUrl)}" style="color:${COLOURS.muted};text-decoration:underline;">Gérer mes préférences</a> ·
<a href="${escapeHtml(preferencesUrl)}" style="color:${COLOURS.muted};text-decoration:underline;">Ne plus recevoir ces e-mails</a>`;
}

/** Rendu commun des e-mails de notification. */
function renderNotificationEmail(
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
  options: { intro?: string; actionLabel?: string },
): EmailContent {
  const notificationsUrl = absoluteUrl("/mon-compte/notifications");
  const resourceUrl = notification.linkUrl ? absoluteUrl(notification.linkUrl) : notificationsUrl;
  const greeting = recipient.name ? `Bonjour ${escapeHtml(recipient.name)},` : "Bonjour,";

  const contentHtml = `<p style="margin:0 0 16px;">${greeting}</p>
<p style="margin:0 0 16px;font-weight:bold;">${escapeHtml(notification.title)}</p>
<p style="margin:0 0 16px;">${escapeHtml(notification.message)}</p>
${options.intro ? `<p style="margin:0 0 16px;">${escapeHtml(options.intro)}</p>` : ""}
${button(resourceUrl, options.actionLabel ?? "Voir sur le site")}`;

  return {
    html: layout({
      title: notification.title,
      contentHtml,
      footerHtml: notificationFooter(),
    }),
    text: `${recipient.name ? `Bonjour ${recipient.name},\n\n` : "Bonjour,\n\n"}${notification.title}\n\n${notification.message}\n\n${options.intro ? `${options.intro}\n\n` : ""}${resourceUrl}\n\nNotifications : ${notificationsUrl}\nPréférences (et désabonnement) : ${absoluteUrl("/mon-compte/preferences")}\n`,
  };
}

/** « Quelqu'un a répondu à votre commentaire ». */
export function renderCommentReplyEmail(
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
): EmailContent {
  return renderNotificationEmail(notification, recipient, {
    actionLabel: "Voir la réponse",
  });
}

/** « Votre commentaire a été approuvé ». */
export function renderCommentApprovedEmail(
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
): EmailContent {
  return renderNotificationEmail(notification, recipient, {
    intro: "Votre contribution est désormais visible par tous les lecteurs.",
    actionLabel: "Voir la discussion",
  });
}

/** « Votre commentaire a été rejeté ». */
export function renderCommentRejectedEmail(
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
): EmailContent {
  return renderNotificationEmail(notification, recipient, {
    intro:
      "La modération n'a pas retenu votre contribution. Vous pouvez répondre à cet e-mail si vous estimez qu'il s'agit d'une erreur.",
    actionLabel: "Relire la charte",
  });
}

/** « Vous avez été banni ». */
export function renderUserBannedEmail(
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
): EmailContent {
  return renderNotificationEmail(notification, recipient, {
    intro:
      "Pendant la durée de la suspension, vous ne pouvez plus commenter ni réagir. Les notifications restent consultables dans votre espace.",
    actionLabel: "Voir mon compte",
  });
}

/** « Votre signalement a été traité ». */
export function renderReportResolvedEmail(
  notification: NotificationEmailData,
  recipient: NotificationRecipient,
): EmailContent {
  return renderNotificationEmail(notification, recipient, {
    intro: "Merci d'avoir signalé ce contenu : la modération a statué.",
    actionLabel: "Voir l'article",
  });
}
