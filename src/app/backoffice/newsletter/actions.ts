"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { sendCampaign } from "@/lib/newsletter-send";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";

/**
 * Server Actions de la newsletter (WP11a, complétées par le WP11b).
 *
 * Le WP11b ajoute `sendCampaignAction` : c'est le seul point d'entrée qui
 * expédie réellement des e-mails. Aucun formulaire de création de campagne
 * (WP11d) et aucune inscription publique (WP11c) ne sont fournis ici.
 *
 * La vérification du rôle est refaite dans chaque action : une Server Action est
 * un point d'entrée HTTP à part entière.
 */

const NEWSLETTER_PATH = "/backoffice/newsletter";

/** Vérifie la session et le rôle ADMIN ; redirige sinon (renvoie l'auteur). */
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

/**
 * Désabonne un abonné depuis l'administration.
 *
 * La date du premier désabonnement est conservée : recliquer ne la réécrit pas,
 * sinon le taux de désabonnement d'un mois donné deviendrait faux à chaque
 * passage. Seules les lignes non encore désabonnées sont donc modifiées.
 */
export async function unsubscribeSubscriber(subscriberId: string): Promise<void> {
  await requireAdmin();

  await prisma.newsletterSubscriber.updateMany({
    where: { id: subscriberId, status: { not: "UNSUBSCRIBED" } },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
  });

  revalidatePath(NEWSLETTER_PATH);
}

/**
 * Duplique une campagne en brouillon : le contenu est repris, les compteurs et
 * les dates d'envoi sont remis à zéro, et le sujet est préfixé pour distinguer
 * la copie de l'originale. Aucune copie des envois passés (c'est une nouvelle
 * campagne) et le créateur est l'administrateur qui duplique.
 */
export async function duplicateCampaign(campaignId: string): Promise<void> {
  const admin = await requireAdmin();

  const campaign = await prisma.newsletterCampaign.findUnique({
    where: { id: campaignId },
    select: {
      listId: true,
      subject: true,
      previewText: true,
      contentHtml: true,
      contentText: true,
    },
  });

  if (!campaign) {
    revalidatePath(NEWSLETTER_PATH);
    return;
  }

  await prisma.newsletterCampaign.create({
    data: {
      listId: campaign.listId,
      subject: `Copie de ${campaign.subject}`,
      previewText: campaign.previewText,
      contentHtml: campaign.contentHtml,
      contentText: campaign.contentText,
      status: "DRAFT",
      createdById: admin.id,
    },
  });

  revalidatePath(NEWSLETTER_PATH);
}

/* ------------------------------------------------ listes de diffusion (WP11f) */

/**
 * Gestion des listes de diffusion depuis l'administration.
 *
 * Ces listes existaient depuis le WP11a, mais n'étaient créables que dans Prisma
 * Studio : sans interface, impossible d'ouvrir une nouvelle liste thématique ni
 * de composer une relance. Le lot WP11d n'avait pas ce périmètre ; ce correctif
 * comble le manque.
 */

const MAX_LIST_NAME = 120;
const MAX_LIST_DESCRIPTION = 300;

/** Slug unique pour une liste : « hebdo-football », puis « hebdo-football-2 »… */
async function uniqueListSlug(name: string): Promise<string> {
  const base = slugify(name) || "liste";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.newsletterList.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
  }
  // Repli improbable : horodatage pour garantir l'unicité.
  return `${base}-${Date.now()}`;
}

/** Lecture et validation des champs d'une liste. */
function readListInput(formData: FormData): { name: string; description: string | null; active: boolean } | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const active = ["on", "true", "1"].includes(String(formData.get("active") ?? "").toLowerCase());

  if (name.length < 2) {
    return { error: "Le nom de la liste doit contenir au moins 2 caractères." };
  }
  if (name.length > MAX_LIST_NAME) {
    return { error: `Le nom ne peut pas dépasser ${MAX_LIST_NAME} caractères.` };
  }
  if (description.length > MAX_LIST_DESCRIPTION) {
    return { error: `La description ne peut pas dépasser ${MAX_LIST_DESCRIPTION} caractères.` };
  }

  return { name, description: description || null, active };
}

/** Création d'une liste de diffusion. */
export async function createList(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const input = readListInput(formData);
  if ("error" in input) {
    return input.error;
  }

  await prisma.newsletterList.create({
    data: {
      name: input.name,
      slug: await uniqueListSlug(input.name),
      description: input.description,
      active: input.active,
    },
  });

  revalidatePath(NEWSLETTER_PATH);
  redirect(`${NEWSLETTER_PATH}?tab=lists&message=liste-creee`);
}

/** Mise à jour d'une liste (nom, description, activation). */
export async function updateList(
  listId: string,
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const existing = await prisma.newsletterList.findUnique({
    where: { id: listId },
    select: { id: true },
  });
  if (!existing) {
    return "Cette liste n'existe plus.";
  }

  const input = readListInput(formData);
  if ("error" in input) {
    return input.error;
  }

  // Le slug n'est pas modifiable : il est déjà référencé par les liens publics
  // et les relances automatiques.
  await prisma.newsletterList.update({
    where: { id: listId },
    data: { name: input.name, description: input.description, active: input.active },
  });

  revalidatePath(NEWSLETTER_PATH);
  redirect(`${NEWSLETTER_PATH}?tab=lists&liste=${listId}&message=liste-maj`);
}

/** Bascule l'activation d'une liste : une liste inactive ne reçoit plus rien. */
export async function toggleList(listId: string): Promise<void> {
  await requireAdmin();

  const list = await prisma.newsletterList.findUnique({
    where: { id: listId },
    select: { active: true },
  });
  if (!list) {
    redirect(`${NEWSLETTER_PATH}?tab=lists&message=introuvable`);
  }

  await prisma.newsletterList.update({
    where: { id: listId },
    data: { active: !list.active },
  });

  revalidatePath(NEWSLETTER_PATH);
  redirect(`${NEWSLETTER_PATH}?tab=lists&message=${list.active ? "liste-desactivee" : "liste-activee"}`);
}

/**
 * Suppression d'une liste.
 *
 * Refusée dès qu'une campagne y est rattachée : la clé étrangère est en cascade,
 * supprimer la liste effacerait les campagnes et tout leur historique d'envoi.
 * Une liste vide (ou seulement remplie d'abonnés, qui ne sont pas supprimés) peut
 * partir.
 */
export async function deleteList(listId: string): Promise<void> {
  await requireAdmin();

  const list = await prisma.newsletterList.findUnique({
    where: { id: listId },
    select: { id: true, _count: { select: { campaigns: true } } },
  });
  if (!list) {
    redirect(`${NEWSLETTER_PATH}?tab=lists&message=introuvable`);
  }
  if (list._count.campaigns > 0) {
    redirect(`${NEWSLETTER_PATH}?tab=lists&liste=${listId}&message=liste-utilisee`);
  }

  await prisma.newsletterList.delete({ where: { id: listId } });

  revalidatePath(NEWSLETTER_PATH);
  redirect(`${NEWSLETTER_PATH}?tab=lists&message=liste-supprimee`);
}

/* ------------------------------------------------------- envoi (WP11b) */

/**
 * Expédie une campagne à tous les abonnés CONFIRMED de sa liste.
 *
 * L'envoi est synchrone : la Server Action attend la fin de la boucle (100 ms
 * entre chaque message) avant de rediriger. Acceptable pour les listes de ce
 * lot ; une file d'attente prendra le relais au WP11d, avec les envois
 * programmés.
 *
 * Le résumé est transmis par l'URL (`?envoi=<envoyés>-<échecs>`) et non par un
 * état de formulaire : la page est un composant serveur, et le compte rendu doit
 * survivre à la redirection.
 */
export async function sendCampaignAction(campaignId: string): Promise<void> {
  await requireAdmin();

  // `redirect` lève une exception de contrôle : il ne doit pas être appelé dans
  // le `try`, sinon il serait capturé comme une erreur d'envoi.
  let summary = "0-0";
  try {
    const result = await sendCampaign(campaignId);
    summary = result.ok ? `${result.sent}-${result.failed}` : "erreur";
  } catch (error) {
    console.error(
      "[newsletter] envoi interrompu :",
      error instanceof Error ? error.message : error,
    );
    summary = "erreur";
  }

  revalidatePath(NEWSLETTER_PATH);
  redirect(
    `${NEWSLETTER_PATH}?${new URLSearchParams({
      tab: "campaigns",
      campagne: campaignId,
      envoi: summary,
    }).toString()}`,
  );
}
