import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Constantes et helpers de la newsletter (WP11a).
 *
 * Ce module ne contient que des libellés, des teintes de badge et des calculs
 * d'affichage : la logique d'envoi (fournisseur, webhooks) relève du WP11b, le
 * formulaire public d'inscription du WP11c et la rédaction des campagnes du
 * WP11d. Aucune dépendance à Prisma ni à un service d'e-mail n'est introduite
 * ici, pour que la page d'administration et les futures suites de tests
 * puissent l'importer sans effet de bord.
 */

/** Nombre de lignes affichées par onglet dans /backoffice/newsletter. */
export const NEWSLETTER_PAGE_SIZE = 25;

/* ------------------------------------------------------------- abonnés */

export const SUBSCRIBER_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "UNSUBSCRIBED",
  "BOUNCED",
] as const;

export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const SUBSCRIBER_STATUS_LABELS: Record<SubscriberStatus, string> = {
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  UNSUBSCRIBED: "Désabonné",
  BOUNCED: "Adresse invalide",
};

/** Teintes du design system, alignées sur celles des autres listes. */
export const SUBSCRIBER_STATUS_TONES: Record<SubscriberStatus, BadgeTone> = {
  PENDING: "accent",
  CONFIRMED: "success",
  UNSUBSCRIBED: "neutral",
  BOUNCED: "danger",
};

export function isSubscriberStatus(value: unknown): value is SubscriberStatus {
  return typeof value === "string" && (SUBSCRIBER_STATUSES as readonly string[]).includes(value);
}

/**
 * Origines d'inscription connues. `source` reste un texte libre en base (le
 * formulaire public du WP11c pourra en inventer d'autres) : ce dictionnaire
 * n'est qu'une aide d'affichage.
 */
export const SUBSCRIBER_SOURCE_LABELS: Record<string, string> = {
  footer: "Pied de page",
  article: "Article",
  popup: "Fenêtre modale",
  compte: "Compte utilisateur",
  import: "Import",
  admin: "Saisie manuelle",
};

/** Libellé lisible d'une origine, ou la valeur brute si elle est inconnue. */
export function subscriberSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  return SUBSCRIBER_SOURCE_LABELS[source] ?? source;
}

/* ----------------------------------------------------------- campagnes */

export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "SENDING",
  "SENT",
  "CANCELLED",
  "FAILED",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Brouillon",
  SCHEDULED: "Programmée",
  SENDING: "En cours d'envoi",
  SENT: "Envoyée",
  CANCELLED: "Annulée",
  FAILED: "Échec",
};

export const CAMPAIGN_STATUS_TONES: Record<CampaignStatus, BadgeTone> = {
  DRAFT: "neutral",
  SCHEDULED: "primary",
  SENDING: "accent",
  SENT: "success",
  CANCELLED: "neutral",
  FAILED: "danger",
};

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === "string" && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------- envois */

export const SEND_STATUSES = [
  "PENDING",
  "SENT",
  "DELIVERED",
  "OPENED",
  "CLICKED",
  "BOUNCED",
  "FAILED",
] as const;

export type SendStatus = (typeof SEND_STATUSES)[number];

export const SEND_STATUS_LABELS: Record<SendStatus, string> = {
  PENDING: "En attente",
  SENT: "Envoyé",
  DELIVERED: "Délivré",
  OPENED: "Ouvert",
  CLICKED: "Cliqué",
  BOUNCED: "Rejeté",
  FAILED: "Échec",
};

export const SEND_STATUS_TONES: Record<SendStatus, BadgeTone> = {
  PENDING: "neutral",
  SENT: "primary",
  DELIVERED: "success",
  OPENED: "success",
  CLICKED: "success",
  BOUNCED: "danger",
  FAILED: "danger",
};

export function isSendStatus(value: unknown): value is SendStatus {
  return typeof value === "string" && (SEND_STATUSES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ calculs */

/**
 * Pourcentage lisible en français (« 42,9 % »), avec une décimale.
 * Un dénominateur nul renvoie « — » plutôt que « NaN % » ou « 0 % » : sans
 * envoi, il n'y a pas de taux, et l'absence doit se voir.
 */
export function percent(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return "—";
  return `${((part / whole) * 100).toFixed(1).replace(".", ",")} %`;
}

/**
 * Taux d'ouverture d'une campagne. Le dénominateur est le nombre de messages
 * délivrés quand il est connu, sinon le nombre de destinataires visés.
 */
export function openRate(campaign: {
  openCount: number;
  deliveredCount: number;
  recipientCount: number;
}): string {
  const base = campaign.deliveredCount > 0 ? campaign.deliveredCount : campaign.recipientCount;
  return percent(campaign.openCount, base);
}

/**
 * Taux de désabonnement : désabonnés rapportés à l'ensemble des inscrits
 * (toutes lignes confondues). Les adresses invalides sont comptées dans le
 * total : elles ont bien été inscrites un jour.
 */
export function unsubscribeRate(total: number, unsubscribed: number): string {
  return percent(unsubscribed, total);
}

/** Début du mois en cours (UTC), pour les compteurs « ce mois-ci ». */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
