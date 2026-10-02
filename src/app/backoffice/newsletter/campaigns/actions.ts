"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  campaignNonOpeners,
  processScheduledCampaigns,
  sendCampaign,
  sendTestCampaignEmail,
} from "@/lib/newsletter-send";
import { prisma } from "@/lib/prisma";

/**
 * Server Actions des campagnes de newsletter (WP11d).
 *
 * Huit actions, toutes réservées aux ADMIN (vérification faite ici, et pas
 * seulement dans les pages : une Server Action est un point d'entrée HTTP).
 *
 * Deux principes :
 *
 *  - **l'état décide** : on n'édite pas une campagne déjà partie, on ne supprime
 *    pas une campagne envoyée, on n'expédie que ce qui est en brouillon ou
 *    planifié. Chaque refus renvoie un message, jamais une exception ;
 *  - **le résumé passe par l'URL** : les pages sont des composants serveur, un
 *    compte rendu ne peut donc pas être renvoyé par un état de formulaire. On
 *    redirige avec `?message=…` (POST/Redirect/GET), ce qui survit au
 *    rafraîchissement.
 */

const CAMPAIGNS_PATH = "/backoffice/newsletter/campaigns";

/** Statuts qu'une campagne peut encore quitter : ni envoi, ni envoyée. */
const EDITABLE_STATUSES = ["DRAFT", "SCHEDULED"] as const;

/** Statuts pour lesquels la suppression est refusée (envoi en cours ou passé). */
const UNDELETABLE_STATUSES = ["SENDING", "SENT"] as const;

const MAX_SUBJECT_LENGTH = 150;
const MAX_PREVIEW_LENGTH = 200;

/** Vérifie la session et le rôle ; redirige sinon (renvoie l'administrateur). */
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

function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Redirection vers la liste avec un compte rendu lisible. */
function backToList(code: string, id?: string): never {
  const params = new URLSearchParams({ message: code });
  if (id) params.set("campagne", id);
  redirect(`${CAMPAIGNS_PATH}?${params.toString()}`);
}

/** Redirection vers le détail d'une campagne. */
function backToCampaign(id: string, code: string): never {
  redirect(`${CAMPAIGNS_PATH}/${id}?message=${code}`);
}

type CampaignInput = {
  subject: string;
  previewText: string | null;
  contentHtml: string;
  listId: string;
  scheduledAt: Date | null;
};

/**
 * Validation du formulaire de campagne.
 *
 * `scheduledAt` accepte la valeur d'un `<input type="datetime-local">`
 * (« 2026-10-01T08:30 »), interprétée en heure locale du serveur — c'est ce
 * qu'attend un administrateur qui saisit une heure de publication.
 */
async function validateCampaign(formData: FormData): Promise<CampaignInput | { error: string }> {
  const subject = readText(formData, "subject");
  const previewText = readText(formData, "previewText");
  const contentHtml = String(formData.get("contentHtml") ?? "").trim();
  const listId = readText(formData, "listId");
  const rawScheduledAt = readText(formData, "scheduledAt");

  if (!subject) {
    return { error: "Le sujet est obligatoire." };
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { error: `Le sujet ne peut pas dépasser ${MAX_SUBJECT_LENGTH} caractères.` };
  }
  if (previewText.length > MAX_PREVIEW_LENGTH) {
    return { error: `Le pré-en-tête ne peut pas dépasser ${MAX_PREVIEW_LENGTH} caractères.` };
  }
  if (!contentHtml) {
    return { error: "Le contenu HTML est obligatoire." };
  }
  if (!listId) {
    return { error: "Choisissez une liste de diffusion." };
  }

  const list = await prisma.newsletterList.findUnique({
    where: { id: listId },
    select: { id: true, active: true },
  });
  if (!list) {
    return { error: "Cette liste de diffusion n'existe pas." };
  }
  if (!list.active) {
    return { error: "Cette liste est inactive : activez-la avant de lui écrire." };
  }

  let scheduledAt: Date | null = null;
  if (rawScheduledAt) {
    const parsed = new Date(rawScheduledAt);
    if (Number.isNaN(parsed.getTime())) {
      return { error: "La date de planification est invalide." };
    }
    scheduledAt = parsed;
  }

  return { subject, previewText: previewText || null, contentHtml, listId, scheduledAt };
}

/* --------------------------------------------------------------- création */

/**
 * Création d'une campagne.
 *
 * Une date de planification renseignée place directement la campagne en
 * SCHEDULED, comme le demande le brief ; sinon elle reste en brouillon.
 */
export async function createCampaign(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const admin = await requireAdmin();

  const result = await validateCampaign(formData);
  if ("error" in result) {
    return result.error;
  }

  const created = await prisma.newsletterCampaign.create({
    data: {
      listId: result.listId,
      subject: result.subject,
      previewText: result.previewText,
      contentHtml: result.contentHtml,
      status: result.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: result.scheduledAt,
      createdById: admin.id,
    },
    select: { id: true },
  });

  revalidatePath(CAMPAIGNS_PATH);
  // « Enregistrer et prévisualiser » se distingue par un champ caché : le
  // formulaire ne peut porter qu'une seule action.
  if (readText(formData, "intent") === "preview") {
    redirect(`${CAMPAIGNS_PATH}/${created.id}/preview`);
  }
  redirect(`${CAMPAIGNS_PATH}/${created.id}?message=cree`);
}

/** Mise à jour d'une campagne en brouillon ou planifiée. */
export async function updateCampaign(
  id: string,
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const existing = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return "Cette campagne n'existe plus.";
  }
  if (!EDITABLE_STATUSES.includes(existing.status as (typeof EDITABLE_STATUSES)[number])) {
    return "Une campagne déjà partie ne peut plus être modifiée.";
  }

  const result = await validateCampaign(formData);
  if ("error" in result) {
    return result.error;
  }

  await prisma.newsletterCampaign.update({
    where: { id },
    data: {
      listId: result.listId,
      subject: result.subject,
      previewText: result.previewText,
      contentHtml: result.contentHtml,
      // Planifier une campagne la met en SCHEDULED ; retirer la date la remet en
      // brouillon — sans quoi elle resterait « planifiée » sans échéance.
      status: result.scheduledAt ? "SCHEDULED" : "DRAFT",
      scheduledAt: result.scheduledAt,
    },
  });

  revalidatePath(CAMPAIGNS_PATH);
  if (readText(formData, "intent") === "preview") {
    redirect(`${CAMPAIGNS_PATH}/${id}/preview`);
  }
  redirect(`${CAMPAIGNS_PATH}/${id}?message=maj`);
}

/* ---------------------------------------------------- duplication, statut */

/** Duplique une campagne en brouillon, sans ses envois ni ses compteurs. */
export async function duplicateCampaign(id: string): Promise<void> {
  const admin = await requireAdmin();

  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: {
      listId: true,
      subject: true,
      previewText: true,
      contentHtml: true,
      contentText: true,
    },
  });
  if (!campaign) {
    backToList("introuvable");
  }

  const copy = await prisma.newsletterCampaign.create({
    data: {
      listId: campaign.listId,
      subject: `Copie de ${campaign.subject}`.slice(0, MAX_SUBJECT_LENGTH),
      previewText: campaign.previewText,
      contentHtml: campaign.contentHtml,
      contentText: campaign.contentText,
      status: "DRAFT",
      createdById: admin.id,
    },
    select: { id: true },
  });

  revalidatePath(CAMPAIGNS_PATH);
  redirect(`${CAMPAIGNS_PATH}/${copy.id}?message=dupliquee`);
}

/** Planifie une campagne (ou retire sa planification si la date est vide). */
export async function scheduleCampaign(id: string, formData: FormData): Promise<void> {
  await requireAdmin();

  const existing = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    backToList("introuvable");
  }
  if (!EDITABLE_STATUSES.includes(existing.status as (typeof EDITABLE_STATUSES)[number])) {
    backToCampaign(id, "non-modifiable");
  }

  const raw = readText(formData, "scheduledAt");
  const scheduledAt = raw ? new Date(raw) : null;
  if (raw && Number.isNaN(scheduledAt?.getTime() ?? NaN)) {
    backToCampaign(id, "date-invalide");
  }

  await prisma.newsletterCampaign.update({
    where: { id },
    data: {
      scheduledAt,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });

  revalidatePath(CAMPAIGNS_PATH);
  backToCampaign(id, scheduledAt ? "planifiee" : "deplanifiee");
}

/** Suppression : refusée dès que la campagne est partie. */
export async function deleteCampaign(id: string): Promise<void> {
  await requireAdmin();

  const existing = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    backToList("introuvable");
  }
  if (UNDELETABLE_STATUSES.includes(existing.status as (typeof UNDELETABLE_STATUSES)[number])) {
    backToCampaign(id, "suppression-refusee");
  }

  // Les envois partent avec la campagne (cascade déclarée dans la migration).
  await prisma.newsletterCampaign.delete({ where: { id } });

  revalidatePath(CAMPAIGNS_PATH);
  backToList("supprimee");
}

/* -------------------------------------------------------------- envois */

/** Envoi immédiat, après la confirmation modale de l'interface. */
export async function sendCampaignNow(id: string): Promise<void> {
  await requireAdmin();

  const summary = await sendCampaign(id).catch((error) => {
    console.error(
      "[newsletter] envoi interrompu :",
      error instanceof Error ? error.message : error,
    );
    return null;
  });

  revalidatePath(CAMPAIGNS_PATH);
  if (!summary) {
    backToCampaign(id, "envoi-erreur");
  }
  if (!summary.ok) {
    backToCampaign(id, "envoi-refuse");
  }
  redirect(`${CAMPAIGNS_PATH}/${id}?message=envoi-${summary.sent}-${summary.failed}`);
}

/** Envoi d'un test à une adresse unique. */
export async function sendTestEmail(id: string, formData: FormData): Promise<void> {
  await requireAdmin();

  const email = readText(formData, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    redirect(`${CAMPAIGNS_PATH}/${id}/preview?message=email-invalide`);
  }

  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: {
      id: true,
      subject: true,
      previewText: true,
      contentHtml: true,
      contentText: true,
    },
  });
  if (!campaign) {
    backToList("introuvable");
  }

  const result = await sendTestCampaignEmail(campaign, email);
  redirect(
    `${CAMPAIGNS_PATH}/${id}/preview?message=${result.success ? "test-envoye" : "test-echec"}&adresse=${encodeURIComponent(email)}`,
  );
}

/** Envoie les campagnes planifiées arrivées à échéance (bouton manuel). */
export async function processScheduledCampaignsAction(): Promise<void> {
  await requireAdmin();

  const run = await processScheduledCampaigns();
  revalidatePath(CAMPAIGNS_PATH);
  backToList(`planifiees-${run.processed.length}-${run.errors.length}`);
}

/* --------------------------------------------------- renvoi ciblé */

/**
 * « Renvoyer aux non-ouvreurs ».
 *
 * Le modèle du WP11a envoie à une **liste** : on crée donc une liste
 * temporaire composée des abonnés qui n'ont pas ouvert la campagne, puis une
 * campagne en brouillon visant cette liste. L'administrateur la relit et
 * l'envoie comme n'importe quelle autre — rien n'est expédié automatiquement.
 *
 * La liste créée est marquée active (elle doit pouvoir être sélectionnée) et
 * nommée d'après la campagne d'origine, avec la date, pour rester identifiable
 * dans l'interface.
 */
export async function resendToNonOpeners(id: string): Promise<void> {
  const admin = await requireAdmin();

  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id },
    select: {
      subject: true,
      previewText: true,
      contentHtml: true,
      contentText: true,
      listId: true,
    },
  });
  if (!campaign) {
    backToList("introuvable");
  }

  const nonOpeners = await campaignNonOpeners(id);
  if (nonOpeners.length === 0) {
    backToCampaign(id, "aucun-non-ouvreur");
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = `non-ouvreurs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;

  const list = await prisma.newsletterList.create({
    data: {
      name: `Non-ouvreurs « ${campaign.subject.slice(0, 60)} » (${stamp})`,
      slug,
      description: `Créée automatiquement depuis la campagne du ${stamp}.`,
      active: true,
      subscribers: { connect: nonOpeners.map((subscriber) => ({ id: subscriber.id })) },
    },
    select: { id: true },
  });

  const copy = await prisma.newsletterCampaign.create({
    data: {
      listId: list.id,
      subject: `Relance : ${campaign.subject}`.slice(0, MAX_SUBJECT_LENGTH),
      previewText: campaign.previewText,
      contentHtml: campaign.contentHtml,
      contentText: campaign.contentText,
      status: "DRAFT",
      createdById: admin.id,
    },
    select: { id: true },
  });

  revalidatePath(CAMPAIGNS_PATH);
  redirect(`${CAMPAIGNS_PATH}/${copy.id}?message=relance-${nonOpeners.length}`);
}
