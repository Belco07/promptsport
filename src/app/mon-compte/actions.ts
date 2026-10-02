"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createBillingPortalSessionUrl,
  isStripeConfigured,
  setSubscriptionCancelAtPeriodEnd,
} from "@/lib/stripe";
import { recordSubscriptionEvent } from "@/lib/subscription";

/**
 * Server Actions de l'espace abonné (WP7d).
 *
 * Profil et mot de passe : formulaires « progressifs » (aucun JavaScript requis)
 * — l'action redirige vers /mon-compte avec un code de résultat lu par la page.
 * Abonnement : appelées depuis les composants clients (boutons avec confirmation)
 * et renvoient un résultat sérialisable.
 */

export type AccountActionResult = { ok: true } | { ok: false; error: string };
export type PortalResult = { ok: true; url: string } | { ok: false; error: string };

/** Origine du site (retours du portail Stripe), déduite de la requête. */
async function getOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  if (host) {
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Lecture d'un champ texte du FormData. */
function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Identifiant de l'utilisateur connecté, ou redirection vers /login. */
async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user.id;
}

/* -------------------------------------------------------------------------- */
/* Profil                                                                     */
/* -------------------------------------------------------------------------- */

/** Mise à jour du nom affiché. L'email reste en lecture seule (WP7d). */
export async function updateProfile(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = readText(formData, "name");

  if (name.length < 2) {
    redirect("/mon-compte?erreur=nom-court");
  }
  if (name.length > 80) {
    redirect("/mon-compte?erreur=nom-long");
  }

  await prisma.author.update({ where: { id: userId }, data: { name } });

  revalidatePath("/mon-compte");
  // Le nom apparaît aussi dans la navigation et sur les articles.
  revalidatePath("/");
  redirect("/mon-compte?profil=maj");
}

/* -------------------------------------------------------------------------- */
/* Sécurité : mot de passe                                                    */
/* -------------------------------------------------------------------------- */

const MIN_PASSWORD_LENGTH = 6;

/** Changement de mot de passe : vérifie l'ancien, valide le nouveau. */
export async function updatePassword(formData: FormData): Promise<void> {
  const userId = await requireUserId();

  const currentPassword = readText(formData, "currentPassword");
  const newPassword = readText(formData, "newPassword");
  const confirmation = readText(formData, "confirmPassword");

  if (!currentPassword || !newPassword || !confirmation) {
    redirect("/mon-compte?erreur=motdepasse-champs");
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    redirect("/mon-compte?erreur=motdepasse-court");
  }
  if (newPassword !== confirmation) {
    redirect("/mon-compte?erreur=motdepasse-different");
  }
  if (newPassword === currentPassword) {
    redirect("/mon-compte?erreur=motdepasse-identique");
  }

  const author = await prisma.author.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!author) {
    redirect("/login");
  }

  const matches = await bcrypt.compare(currentPassword, author.passwordHash);
  if (!matches) {
    redirect("/mon-compte?erreur=motdepasse-actuel");
  }

  await prisma.author.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });

  redirect("/mon-compte?motdepasse=maj");
}

/* -------------------------------------------------------------------------- */
/* Abonnement                                                                 */
/* -------------------------------------------------------------------------- */

/** Abonnement en cours de l'utilisateur, s'il est gérable côté Stripe. */
async function getManageableSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: "ACTIVE", currentPeriodEnd: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, stripeSubscriptionId: true },
  });
}

/**
 * Annule l'abonnement en fin de période (`cancel_at_period_end: true`) :
 * l'abonné conserve l'accès jusqu'à l'échéance, puis l'abonnement s'arrête.
 */
export async function cancelSubscription(): Promise<AccountActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Vous devez être connecté." };
  }
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe n'est pas configuré sur ce site." };
  }

  const subscription = await getManageableSubscription(session.user.id);
  if (!subscription?.stripeSubscriptionId) {
    return { ok: false, error: "Aucun abonnement annulable n'a été trouvé." };
  }

  try {
    await setSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId, true);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Erreur Stripe : ${error.message}` : "Erreur inconnue.",
    };
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: true },
  });
  await recordSubscriptionEvent(subscription.id, "CANCELED", {
    source: "mon-compte",
    scheduled: true,
  });

  revalidatePath("/mon-compte");
  revalidatePath("/mon-compte/abonnement");
  return { ok: true };
}

/** Réactive l'abonnement : annule la résiliation programmée. */
export async function reactivateSubscription(): Promise<AccountActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Vous devez être connecté." };
  }
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe n'est pas configuré sur ce site." };
  }

  const subscription = await getManageableSubscription(session.user.id);
  if (!subscription?.stripeSubscriptionId) {
    return { ok: false, error: "Aucun abonnement à réactiver n'a été trouvé." };
  }

  try {
    await setSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId, false);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Erreur Stripe : ${error.message}` : "Erreur inconnue.",
    };
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: false },
  });
  await recordSubscriptionEvent(subscription.id, "REACTIVATED", {
    source: "mon-compte",
  });

  revalidatePath("/mon-compte");
  revalidatePath("/mon-compte/abonnement");
  return { ok: true };
}

/** Ouvre le portail de facturation Stripe (moyens de paiement, factures). */
export async function openBillingPortal(): Promise<PortalResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Vous devez être connecté." };
  }
  if (!isStripeConfigured()) {
    return { ok: false, error: "Stripe n'est pas configuré sur ce site." };
  }

  const author = await prisma.author.findUnique({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });
  if (!author?.stripeCustomerId) {
    return { ok: false, error: "Aucun compte de facturation n'est associé à votre profil." };
  }

  try {
    const url = await createBillingPortalSessionUrl(
      author.stripeCustomerId,
      `${await getOrigin()}/mon-compte`,
    );
    return { ok: true, url };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Erreur Stripe : ${error.message}` : "Erreur inconnue.",
    };
  }
}
