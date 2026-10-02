import { randomUUID } from "node:crypto";

import type {
  CampaignStatus,
  NewsletterSubscriber,
  SubscriberStatus,
} from "@/generated/prisma/client";
import {
  renderCampaignEmail,
  renderConfirmationEmail,
  renderWelcomeEmail,
} from "@/lib/email-templates";
import { prisma } from "@/lib/prisma";
import { sendEmail, type SendEmailResult } from "@/lib/resend";
import { absoluteUrl } from "@/lib/seo";

/**
 * Envoi des campagnes et cycle de vie d'un abonné (WP11b).
 *
 * Trois responsabilités :
 *
 *  - `sendCampaign` : expédie une campagne à tous les abonnés **CONFIRMED** de sa
 *    liste, un `NewsletterSend` par destinataire, et tient les compteurs ;
 *  - `sendConfirmationEmail` / `sendWelcomeEmail` : le double opt-in (RGPD) ;
 *  - `recordSendEvent` : applique un événement du fournisseur (webhook Resend ou
 *    pixel de suivi) à un envoi, puis recalcule les compteurs de la campagne.
 *
 * Deux choix structurants :
 *
 *  1. **un échec n'arrête rien** : chaque envoi est isolé, l'échec est consigné
 *     dans le `NewsletterSend` correspondant (`FAILED` + `errorMessage`) et la
 *     boucle continue — un destinataire invalide ne doit pas bloquer les autres.
 *  2. **les compteurs sont recalculés, pas incrémentés** : un webhook peut arriver
 *     deux fois (Resend réessaie) ; compter les lignes concernées rend l'opération
 *     idempotente par construction.
 *
 * Le jeton public d'un abonné est `confirmationToken` : le schéma du WP11a ne
 * prévoit pas de colonne distincte pour le désabonnement. Il n'est donc jamais
 * effacé — un lien de désabonnement doit rester valable des mois plus tard.
 */

/** Délai entre deux envois, pour rester sous les limites de l'API Resend. */
export const SEND_DELAY_MS = 100;

/** Statuts depuis lesquels une campagne peut être expédiée. */
const SENDABLE_STATUSES: CampaignStatus[] = ["DRAFT", "SCHEDULED"];

/**
 * Rang d'avancement d'un envoi : un événement ne fait jamais reculer un envoi
 * (une ouverture signalée après un clic ne rétrograde pas la ligne).
 */
const SEND_RANK: Record<string, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  OPENED: 3,
  CLICKED: 4,
};

export type CampaignSendSummary = {
  ok: boolean;
  /** Renseigné quand la campagne n'a pas pu être expédiée du tout. */
  error?: string;
  status: CampaignStatus;
  /** Abonnés confirmés visés. */
  recipients: number;
  sent: number;
  failed: number;
  /** Destinataires déjà servis lors d'un envoi précédent. */
  skipped: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------ jeton public */

/**
 * Jeton public de l'abonné (confirmation puis désabonnement), créé au besoin.
 * Les abonnés saisis à la main dans Prisma Studio n'en ont pas : sans cette
 * génération, leur e-mail de confirmation ne pourrait pas être construit.
 */
export async function ensurePublicToken(
  subscriber: Pick<NewsletterSubscriber, "id" | "confirmationToken">,
): Promise<string> {
  if (subscriber.confirmationToken) {
    return subscriber.confirmationToken;
  }
  const token = randomUUID();
  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: { confirmationToken: token },
  });
  return token;
}

/** URL de désabonnement d'un abonné. */
export function unsubscribeUrl(token: string): string {
  return absoluteUrl(`/newsletter/unsubscribe/${token}`);
}

/** URL du pixel de suivi d'ouverture d'un envoi. */
export function trackingPixelUrl(sendId: string): string {
  return absoluteUrl(`/api/newsletter/track-open/${sendId}`);
}

/* ------------------------------------------------------------ confirmation */

export type ConfirmOutcome =
  | { status: "confirmed"; subscriber: { id: string; email: string; name: string | null } }
  | { status: "already-confirmed"; subscriber: { id: string; email: string; name: string | null } }
  | { status: "bounced"; subscriber: { id: string; email: string; name: string | null } }
  | { status: "invalid" };

/**
 * Confirme une inscription à partir du jeton reçu par e-mail.
 *
 * Une adresse invalide (BOUNCED) n'est pas réactivée : le fournisseur a constaté
 * que l'adresse n'existe pas, un clic sur un vieux lien ne change pas ce fait.
 */
export async function confirmSubscriberByToken(token: string): Promise<ConfirmOutcome> {
  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { confirmationToken: token },
    select: { id: true, email: true, name: true, status: true, confirmedAt: true },
  });

  if (!subscriber) {
    return { status: "invalid" };
  }

  const identity = { id: subscriber.id, email: subscriber.email, name: subscriber.name };

  if (subscriber.status === "BOUNCED") {
    return { status: "bounced", subscriber: identity };
  }
  if (subscriber.status === "CONFIRMED" && subscriber.confirmedAt) {
    return { status: "already-confirmed", subscriber: identity };
  }

  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: { status: "CONFIRMED", confirmedAt: new Date(), unsubscribedAt: null },
  });

  return { status: "confirmed", subscriber: identity };
}

export type UnsubscribeOutcome =
  | { status: "unsubscribed"; subscriber: { id: string; email: string } }
  | { status: "already-unsubscribed"; subscriber: { id: string; email: string } }
  | { status: "invalid" };

/** Abonné identifié par son jeton public, pour les pages de gestion (WP11c). */
export type TokenSubscriber = {
  id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
  listIds: string[];
};

/**
 * Lecture seule : l'abonné correspondant à un jeton public, avec ses listes.
 *
 * Le WP11c impose qu'un GET ne modifie rien. Toutes les pages qui ne font
 * qu'afficher (confirmation, désabonnement, préférences) passent donc par cette
 * fonction, et les mutations sont isolées dans les fonctions ci-dessous,
 * appelées uniquement par des Server Actions.
 */
export async function getSubscriberByToken(token: string): Promise<TokenSubscriber | null> {
  if (!token) {
    return null;
  }

  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { confirmationToken: token },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      confirmedAt: true,
      unsubscribedAt: true,
      lists: { select: { id: true } },
    },
  });

  if (!subscriber) {
    return null;
  }

  return {
    id: subscriber.id,
    email: subscriber.email,
    name: subscriber.name,
    status: subscriber.status,
    confirmedAt: subscriber.confirmedAt,
    unsubscribedAt: subscriber.unsubscribedAt,
    listIds: subscriber.lists.map((list) => list.id),
  };
}

/** Listes de diffusion proposées au public : les listes actives, par nom. */
export function availableLists(): Promise<{ id: string; name: string; description: string | null }[]> {
  return prisma.newsletterList.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, description: true },
  });
}

/**
 * Désabonne à partir du jeton reçu : la date du premier désabonnement est
 * conservée (rejouer l'opération ne la réécrit pas).
 *
 * Fonction de **mutation** : depuis le WP11c, elle n'est appelée que par la
 * Server Action déclenchée par le bouton de confirmation. La page de
 * désabonnement, elle, se contente de lire le statut.
 */
async function unsubscribeByToken(token: string): Promise<UnsubscribeOutcome> {
  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { confirmationToken: token },
    select: { id: true, email: true, status: true, unsubscribedAt: true },
  });

  if (!subscriber) {
    return { status: "invalid" };
  }

  const identity = { id: subscriber.id, email: subscriber.email };

  if (subscriber.status === "UNSUBSCRIBED" && subscriber.unsubscribedAt) {
    return { status: "already-unsubscribed", subscriber: identity };
  }

  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
  });

  return { status: "unsubscribed", subscriber: identity };
}

/**
 * Désabonne réellement (WP11c) : appelée par la Server Action déclenchée par le
 * bouton de confirmation, jamais par la page elle-même.
 */
export async function confirmUnsubscribeByToken(token: string): Promise<UnsubscribeOutcome> {
  return unsubscribeByToken(token);
}

/**
 * Enregistre les préférences de listes d'un abonné.
 *
 * Deux conséquences voulues par le brief :
 *
 *  - un abonné **UNSUBSCRIBED** qui choisit de nouveau une liste se réabonne :
 *    son statut repasse à CONFIRMED et la date de désabonnement est effacée.
 *    C'est un consentement actif de sa part, pas une réactivation silencieuse ;
 *  - une adresse **BOUNCED** n'est pas réactivée : le fournisseur a constaté
 *    qu'elle n'existe pas.
 *
 * Une sélection vide est refusée : se désabonner de tout a sa propre page, avec
 * sa confirmation explicite. Enregistrer « aucune liste » laisserait sinon un
 * abonné CONFIRMED que plus aucune campagne n'atteindrait — un état faux.
 */
export type PreferencesOutcome =
  | { status: "saved"; subscriber: TokenSubscriber }
  | { status: "empty" }
  | { status: "bounced"; subscriber: TokenSubscriber }
  | { status: "invalid" };

export async function updateSubscriberPreferences(
  token: string,
  listIds: string[],
): Promise<PreferencesOutcome> {
  const subscriber = await getSubscriberByToken(token);
  if (!subscriber) {
    return { status: "invalid" };
  }
  if (subscriber.status === "BOUNCED") {
    return { status: "bounced", subscriber };
  }

  // Seules les listes actives sont acceptées : une liste désactivée depuis
  // l'administration ne doit pas pouvoir être rejointe par un ancien formulaire.
  const lists = await prisma.newsletterList.findMany({
    where: { id: { in: listIds }, active: true },
    select: { id: true },
  });

  if (lists.length === 0) {
    return { status: "empty" };
  }

  const listIdSet = lists.map((list) => list.id);
  const resubscribing = subscriber.status !== "CONFIRMED";

  await prisma.newsletterSubscriber.update({
    where: { id: subscriber.id },
    data: {
      lists: { set: listIdSet.map((id) => ({ id })) },
      ...(resubscribing
        ? { status: "CONFIRMED" as const, unsubscribedAt: null, confirmedAt: subscriber.confirmedAt ?? new Date() }
        : {}),
    },
  });

  const updated = await getSubscriberByToken(token);
  return updated ? { status: "saved", subscriber: updated } : { status: "invalid" };
}

/* ------------------------------------------------- e-mails transactionnels */

/** E-mail de confirmation d'inscription (double opt-in). */
export async function sendConfirmationEmail(
  subscriber: Pick<NewsletterSubscriber, "id" | "email" | "name" | "confirmationToken">,
): Promise<SendEmailResult> {
  const token = await ensurePublicToken(subscriber);
  const content = renderConfirmationEmail(
    { email: subscriber.email, name: subscriber.name },
    token,
  );

  return sendEmail({
    to: subscriber.email,
    subject: "Confirmez votre inscription à la newsletter",
    html: content.html,
    text: content.text,
    tags: [{ name: "subscriber_id", value: subscriber.id }],
  });
}

/** E-mail de bienvenue, après confirmation. */
export async function sendWelcomeEmail(
  subscriber: Pick<NewsletterSubscriber, "id" | "email" | "name" | "confirmationToken">,
): Promise<SendEmailResult> {
  const token = await ensurePublicToken(subscriber);
  const content = renderWelcomeEmail({ email: subscriber.email, name: subscriber.name });

  return sendEmail({
    to: subscriber.email,
    subject: "Bienvenue dans la newsletter !",
    html: content.html,
    text: content.text,
    // Un lien de désabonnement dans l'e-mail de bienvenue : l'abonné doit
    // pouvoir partir dès le premier message reçu.
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl(token)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    tags: [{ name: "subscriber_id", value: subscriber.id }],
  });
}

/* ------------------------------------------------------------------ campagne */

/**
 * Recalcule les compteurs d'une campagne à partir de ses envois.
 *
 * Idempotent : appelé après chaque événement du fournisseur, il donne toujours le
 * même résultat pour un même état de la base, même si le webhook arrive deux fois.
 */
export async function recountCampaign(campaignId: string): Promise<void> {
  const [delivered, opened, clicked, bounced] = await Promise.all([
    prisma.newsletterSend.count({ where: { campaignId, deliveredAt: { not: null } } }),
    prisma.newsletterSend.count({ where: { campaignId, openedAt: { not: null } } }),
    prisma.newsletterSend.count({ where: { campaignId, clickedAt: { not: null } } }),
    prisma.newsletterSend.count({ where: { campaignId, status: "BOUNCED" } }),
  ]);

  await prisma.newsletterCampaign.update({
    where: { id: campaignId },
    data: {
      deliveredCount: delivered,
      openCount: opened,
      clickCount: clicked,
      bounceCount: bounced,
    },
  });
}

/**
 * Expédie une campagne à tous les abonnés CONFIRMED de sa liste.
 *
 * Le `NewsletterSend` est créé **avant** l'envoi : son identifiant sert au pixel
 * de suivi et au lien de désabonnement, et une panne au milieu de la boucle
 * laisse une trace exploitable (`PENDING` ou `FAILED`) plutôt qu'un destinataire
 * silencieusement oublié.
 */
export async function sendCampaign(
  campaignId: string,
  options: { delayMs?: number; onProgress?: (message: string) => void } = {},
): Promise<CampaignSendSummary> {
  const delayMs = options.delayMs ?? SEND_DELAY_MS;
  const log = options.onProgress ?? (() => {});

  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true,
      subject: true,
      previewText: true,
      contentHtml: true,
      contentText: true,
      status: true,
      listId: true,
      list: { select: { name: true } },
    },
  });

  if (!campaign) {
    return {
      ok: false,
      error: "Campagne introuvable.",
      status: "DRAFT",
      recipients: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  if (!SENDABLE_STATUSES.includes(campaign.status)) {
    return {
      ok: false,
      error: `Campagne « ${campaign.subject} » déjà ${campaign.status} : seul un brouillon ou une campagne programmée peut être expédié.`,
      status: campaign.status,
      recipients: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  // Seuls les abonnés confirmés reçoivent la campagne : ni les inscriptions en
  // attente (double opt-in non terminé), ni les désabonnés, ni les adresses
  // rejetées par le fournisseur.
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: { status: "CONFIRMED", lists: { some: { id: campaign.listId } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, confirmationToken: true },
  });

  log(
    `Campagne « ${campaign.subject} » → liste « ${campaign.list.name} » : ${subscribers.length} abonné(s) confirmé(s).`,
  );

  await prisma.newsletterCampaign.update({
    where: { id: campaign.id },
    data: { status: "SENDING" },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const [index, subscriber] of subscribers.entries()) {
    // Reprise après incident : un destinataire déjà servi n'est pas renvoyé, un
    // envoi précédemment en échec est retenté.
    const previous = await prisma.newsletterSend.findUnique({
      where: {
        campaignId_subscriberId: { campaignId: campaign.id, subscriberId: subscriber.id },
      },
      select: { id: true, status: true },
    });

    if (previous && previous.status !== "FAILED") {
      skipped += 1;
      continue;
    }

    const token = await ensurePublicToken(subscriber);
    const send = previous
      ? await prisma.newsletterSend.update({
          where: { id: previous.id },
          data: { status: "PENDING", errorMessage: null },
          select: { id: true },
        })
      : await prisma.newsletterSend.create({
          data: {
            campaignId: campaign.id,
            subscriberId: subscriber.id,
            status: "PENDING",
          },
          select: { id: true },
        });

    const content = renderCampaignEmail(
      {
        subject: campaign.subject,
        previewText: campaign.previewText,
        contentHtml: campaign.contentHtml,
        contentText: campaign.contentText,
      },
      { email: subscriber.email, name: subscriber.name },
      { unsubscribeUrl: unsubscribeUrl(token), trackingPixelUrl: trackingPixelUrl(send.id) },
    );

    const result = await sendEmail({
      to: subscriber.email,
      subject: campaign.subject,
      html: content.html,
      text: content.text,
      // Un lien de désabonnement en en-tête : certains clients (Gmail, Apple Mail)
      // affichent alors leur propre bouton « Se désabonner », ce qui évite un
      // signalement pour spam.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl(token)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      // Les étiquettes permettent de retrouver l'envoi depuis un webhook même si
      // l'identifiant du fournisseur venait à manquer.
      tags: [
        { name: "send_id", value: send.id },
        { name: "campaign_id", value: campaign.id },
      ],
    });

    if (result.success) {
      await prisma.newsletterSend.update({
        where: { id: send.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.id,
          errorMessage: null,
        },
      });
      sent += 1;
      log(`  ✓ ${subscriber.email}`);
    } else {
      await prisma.newsletterSend.update({
        where: { id: send.id },
        data: { status: "FAILED", errorMessage: result.error.slice(0, 500) },
      });
      failed += 1;
      log(`  ✗ ${subscriber.email} — ${result.error}`);
    }

    if (delayMs > 0 && index < subscribers.length - 1) {
      await sleep(delayMs);
    }
  }

  await recountCampaign(campaign.id);

  // Une campagne dont aucun envoi n'a été accepté par le fournisseur est en
  // échec, pas « envoyée » : le brief demande SENT en fin de boucle, mais
  // annoncer SENT après zéro envoi rendrait l'écran d'administration mensonger.
  const status: CampaignStatus = failed > 0 && sent === 0 && subscribers.length > 0
    ? "FAILED"
    : "SENT";

  await prisma.newsletterCampaign.update({
    where: { id: campaign.id },
    data: { status, sentAt: new Date(), recipientCount: subscribers.length },
  });

  log(
    `Terminé : ${sent} envoyé(s), ${failed} échec(s), ${skipped} déjà servi(s) — statut ${status}.`,
  );

  return { ok: true, status, recipients: subscribers.length, sent, failed, skipped };
}

/* ------------------------------------------------- campagnes (WP11d) */

/** Nombre de destinataires visés par une campagne : abonnés CONFIRMED de la liste. */
export async function countCampaignRecipients(listId: string): Promise<number> {
  return prisma.newsletterSubscriber.count({
    where: { status: "CONFIRMED", lists: { some: { id: listId } } },
  });
}

/**
 * Envoi d'un test à une adresse unique (WP11d).
 *
 * Le message est rendu exactement comme la campagne, mais avec des liens de
 * désabonnement et de suivi factices : un test ne doit ni compter comme une
 * ouverture, ni permettre de désabonner quelqu'un. Aucun `NewsletterSend` n'est
 * créé — un test n'est pas un envoi de la campagne.
 */
export async function sendTestCampaignEmail(
  campaign: { id: string; subject: string; previewText: string | null; contentHtml: string; contentText: string | null },
  to: string,
): Promise<SendEmailResult> {
  const content = renderCampaignEmail(
    {
      subject: campaign.subject,
      previewText: campaign.previewText,
      contentHtml: campaign.contentHtml,
      contentText: campaign.contentText,
    },
    { email: to, name: null },
    {
      unsubscribeUrl: absoluteUrl("/newsletter/preferences/apercu"),
      trackingPixelUrl: absoluteUrl("/api/newsletter/track-open/apercu"),
    },
  );

  return sendEmail({
    to,
    subject: `[TEST] ${campaign.subject}`,
    html: content.html,
    text: content.text,
    tags: [{ name: "campaign_test", value: campaign.id }],
  });
}

/**
 * Destinataires d'une campagne qui ne l'ont pas ouverte (WP11d).
 *
 * Un envoi rejeté n'est pas « non-ouvreur » : l'adresse n'a jamais reçu le
 * message, la relancer n'aurait pas de sens.
 */
export function campaignNonOpeners(campaignId: string): Promise<
  { id: string; email: string; name: string | null }[]
> {
  return prisma.newsletterSubscriber.findMany({
    where: {
      status: "CONFIRMED",
      sends: { some: { campaignId, openedAt: null, status: { notIn: ["BOUNCED", "FAILED"] } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true },
  });
}

/**
 * Envoie les campagnes planifiées arrivées à échéance (WP11d).
 *
 * Appelée par l'endpoint `/api/cron/newsletter`, jamais par une page : l'ordre
 * est celui de la planification, et une campagne en échec n'empêche pas les
 * suivantes d'être traitées.
 */
export type ScheduledRun = {
  processed: { id: string; subject: string; sent: number; failed: number; status: CampaignStatus }[];
  errors: { id: string; error: string }[];
};

export async function processScheduledCampaigns(now: Date = new Date()): Promise<ScheduledRun> {
  const due = await prisma.newsletterCampaign.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, subject: true },
  });

  const run: ScheduledRun = { processed: [], errors: [] };

  for (const campaign of due) {
    try {
      const summary = await sendCampaign(campaign.id);
      if (!summary.ok) {
        run.errors.push({ id: campaign.id, error: summary.error ?? "envoi refusé" });
        continue;
      }
      run.processed.push({
        id: campaign.id,
        subject: campaign.subject,
        sent: summary.sent,
        failed: summary.failed,
        status: summary.status,
      });
    } catch (error) {
      run.errors.push({
        id: campaign.id,
        error: error instanceof Error ? error.message : "erreur inconnue",
      });
    }
  }

  return run;
}

/* --------------------------------------------------------------- événements */
export type SendEventKind = "delivered" | "opened" | "clicked" | "bounced" | "complained";

export type SendEventInput = {
  kind: SendEventKind;
  /** Notre identifiant d'envoi (pixel de suivi). */
  sendId?: string | null;
  /** Identifiant du message chez Resend (webhooks). */
  providerMessageId?: string | null;
  /** Motif transmis par le fournisseur (rejet). */
  errorMessage?: string | null;
};

export type SendEventResult = {
  ok: boolean;
  reason?: string;
  sendId?: string;
  campaignId?: string;
};

/**
 * Applique un événement du fournisseur à un envoi, puis met à jour la campagne.
 *
 * L'avancement ne recule jamais (`SEND_RANK`) et l'opération est idempotente :
 * rejouer le même événement ne modifie ni les dates déjà posées, ni les
 * compteurs — Resend peut réémettre un webhook resté sans réponse.
 */
export async function recordSendEvent(input: SendEventInput): Promise<SendEventResult> {
  const send = input.sendId
    ? await prisma.newsletterSend.findUnique({
        where: { id: input.sendId },
        select: { id: true, campaignId: true, subscriberId: true, status: true, deliveredAt: true, openedAt: true, clickedAt: true },
      })
    : input.providerMessageId
      ? await prisma.newsletterSend.findFirst({
          where: { providerMessageId: input.providerMessageId },
          select: { id: true, campaignId: true, subscriberId: true, status: true, deliveredAt: true, openedAt: true, clickedAt: true },
        })
      : null;

  if (!send) {
    return { ok: false, reason: "Envoi introuvable pour cet événement." };
  }

  const now = new Date();
  const data: Record<string, unknown> = {};

  if (input.kind === "bounced") {
    // Un rejet est terminal : il prime sur tout avancement.
    data.status = "BOUNCED";
    data.errorMessage = (input.errorMessage ?? "Adresse rejetée par le fournisseur").slice(0, 500);
  } else if (input.kind !== "complained") {
    // Les clés de SEND_RANK sont les statuts Prisma (majuscules) : le type
    // d'événement arrive en minuscules, d'où la conversion — sans elle, le rang
    // visé vaut `undefined` et le statut ne progresse jamais (les horodatages,
    // eux, seraient bien posés : un bug silencieux).
    const target = SEND_RANK[input.kind.toUpperCase()] ?? 0;
    const current = SEND_RANK[send.status] ?? 0;

    // Une ouverture ou un clic vaut délivrance : certains fournisseurs
    // n'émettent pas d'événement « delivered » avant l'ouverture.
    if (!send.deliveredAt) {
      data.deliveredAt = now;
    }
    if (input.kind === "opened" && !send.openedAt) {
      data.openedAt = now;
    }
    if (input.kind === "clicked" && !send.clickedAt) {
      data.clickedAt = now;
    }
    if (target > current) {
      data.status = input.kind.toUpperCase();
    }
  }
  // « complained » ne laisse aucune trace sur l'envoi : la plainte concerne
  // l'abonné, pas le message lui-même.

  if (Object.keys(data).length > 0) {
    await prisma.newsletterSend.update({ where: { id: send.id }, data });
  }

  // Conséquences sur l'abonné.
  if (input.kind === "bounced") {
    await prisma.newsletterSubscriber.update({
      where: { id: send.subscriberId },
      data: { status: "BOUNCED" },
    });
  }
  if (input.kind === "complained") {
    // Une plainte pour spam vaut désabonnement immédiat, même si l'abonné n'a
    // rien demandé : c'est la seule réponse acceptable pour préserver la
    // réputation d'envoi du domaine.
    await prisma.newsletterSubscriber.update({
      where: { id: send.subscriberId },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: now },
    });
  }

  await recountCampaign(send.campaignId);

  return { ok: true, sendId: send.id, campaignId: send.campaignId };
}
