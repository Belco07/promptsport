"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { recordSubscriptionEvent } from "@/lib/subscription";

/**
 * Actions d'administration des abonnements (WP7e).
 *
 * Réservées aux ADMIN. Les remboursements sont manuels (aucun remboursement
 * automatique) et aucune relance de paiement échoué n'est déclenchée.
 */

const BASE = "/backoffice/subscriptions";

/** Lecture d'un champ texte du FormData. */
function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** Contrôle d'accès : ADMIN uniquement. */
async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }
}

/**
 * Annule un abonnement en fin de période (`cancel_at_period_end: true`).
 * L'abonné conserve l'accès jusqu'à l'échéance.
 */
export async function adminCancelSubscription(formData: FormData): Promise<void> {
  await requireAdmin();

  const subscriptionId = readText(formData, "subscriptionId");
  const detailPath = `${BASE}/${subscriptionId}`;
  if (!subscriptionId) {
    redirect(`${BASE}?erreur=abonnement-introuvable`);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, stripeSubscriptionId: true, status: true },
  });
  if (!subscription) {
    redirect(`${BASE}?erreur=abonnement-introuvable`);
  }
  if (!subscription.stripeSubscriptionId) {
    // Un plan à vie n'a pas d'abonnement Stripe : rien à annuler côté Stripe.
    redirect(`${detailPath}?erreur=sans-abonnement-stripe`);
  }
  if (!isStripeConfigured()) {
    redirect(`${detailPath}?erreur=stripe-non-configure`);
  }

  let stripeError: string | null = null;
  try {
    await getStripe().subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (error) {
    stripeError = error instanceof Error ? error.message : "erreur inconnue";
  }

  if (stripeError) {
    redirect(`${detailPath}?erreur=${encodeURIComponent(stripeError)}`);
  }

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: true },
  });
  await recordSubscriptionEvent(subscription.id, "CANCELED", {
    source: "backoffice",
    scheduled: true,
  });

  revalidatePath(BASE);
  revalidatePath(detailPath);
  redirect(`${detailPath}?resultat=annule`);
}

/**
 * Rembourse un paiement (remboursement manuel, total) puis marque le paiement
 * comme remboursé et journalise l'événement.
 */
export async function adminRefundPayment(formData: FormData): Promise<void> {
  await requireAdmin();

  const paymentId = readText(formData, "paymentId");
  const payment = paymentId
    ? await prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          subscriptionId: true,
          stripePaymentIntentId: true,
        },
      })
    : null;

  if (!payment) {
    redirect(`${BASE}?erreur=paiement-introuvable`);
  }

  const detailPath = `${BASE}/${payment.subscriptionId}`;
  if (!payment.stripePaymentIntentId) {
    redirect(`${detailPath}?erreur=paiement-sans-intent`);
  }
  if (!isStripeConfigured()) {
    redirect(`${detailPath}?erreur=stripe-non-configure`);
  }

  let refundError: string | null = null;
  let refundId: string | null = null;
  try {
    const refund = await getStripe().refunds.create({
      payment_intent: payment.stripePaymentIntentId,
    });
    refundId = refund.id;
  } catch (error) {
    refundError = error instanceof Error ? error.message : "erreur inconnue";
  }

  if (refundError) {
    redirect(`${detailPath}?erreur=${encodeURIComponent(refundError)}`);
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: "REFUNDED" },
  });
  await recordSubscriptionEvent(payment.subscriptionId, "REFUNDED", {
    source: "backoffice",
    amount: payment.amount,
    currency: payment.currency,
    refundId,
    paymentIntentId: payment.stripePaymentIntentId,
  });

  revalidatePath(BASE);
  revalidatePath(detailPath);
  redirect(`${detailPath}?resultat=rembourse`);
}
