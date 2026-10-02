"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type Stripe from "stripe";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/stripe";

/**
 * Server Actions Stripe (WP7b) : souscription et portail de facturation.
 */

export type StripeRedirectResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** Origine du site (pour les URL de retour Stripe), déduite de la requête. */
async function getOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host");
  if (host) {
    const proto = headerList.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}`;
  }
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function isRecurringInterval(interval: string): boolean {
  return interval === "MONTH" || interval === "YEAR";
}

/**
 * Crée une session Stripe Checkout pour le plan donné et renvoie son URL.
 * Le prix Stripe est créé à la volée la première fois, puis réutilisé.
 */
export async function createCheckoutSession(
  planId: string,
): Promise<StripeRedirectResult> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.active) {
    return { ok: false, error: "Ce plan n'est pas disponible." };
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Stripe indisponible." };
  }

  const user = await prisma.author.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return { ok: false, error: "Utilisateur introuvable." };
  }

  try {
    // 1) Prix Stripe (créé puis mémorisé si absent).
    let priceId = plan.stripePriceId;
    if (!priceId) {
      const product = await stripe.products.create({
        name: plan.name,
        description: plan.description ?? undefined,
      });
      const recurring = isRecurringInterval(plan.interval);
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.price,
        currency: plan.currency.toLowerCase(),
        ...(recurring
          ? { recurring: { interval: plan.interval === "MONTH" ? "month" : "year" } }
          : {}),
      });
      priceId = price.id;
      await prisma.plan.update({ where: { id: plan.id }, data: { stripePriceId: priceId } });
    }

    // 2) Client Stripe (créé si l'utilisateur n'en a pas encore).
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.author.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    // 3) Session Checkout.
    const origin = await getOrigin();
    const recurring = isRecurringInterval(plan.interval);
    const checkout = await stripe.checkout.sessions.create({
      mode: recurring ? "subscription" : "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/abonnement/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/abonnement/cancel`,
      metadata: { planId: plan.id, userId: user.id },
      ...(recurring
        ? { subscription_data: { metadata: { planId: plan.id, userId: user.id } } }
        : {
            payment_intent_data: { metadata: { planId: plan.id, userId: user.id } },
            // Stripe ne crée pas de facture pour un paiement unique : on la
            // demande explicitement (WP7e), sinon l'achat à vie n'aurait aucun
            // justificatif dans l'espace abonné.
            invoice_creation: { enabled: true },
          }),
    });

    if (!checkout.url) {
      return { ok: false, error: "Stripe n'a pas renvoyé d'URL de paiement." };
    }
    return { ok: true, url: checkout.url };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Erreur Stripe : ${error.message}`
          : "Erreur inconnue lors de la création de la session de paiement.",
    };
  }
}

/** Crée une session du portail client Stripe et renvoie son URL. */
export async function createBillingPortalSession(): Promise<StripeRedirectResult> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const user = await prisma.author.findUnique({ where: { id: session.user.id } });
  if (!user?.stripeCustomerId) {
    return { ok: false, error: "Aucun compte de facturation associé à votre profil." };
  }

  try {
    const stripe = getStripe();
    const origin = await getOrigin();
    const portal = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${origin}/abonnement`,
    });
    return { ok: true, url: portal.url };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Erreur Stripe : ${error.message}`
          : "Erreur inconnue lors de l'ouverture du portail de facturation.",
    };
  }
}
