import Stripe from "stripe";

/**
 * Client Stripe (mode test) — WP7b.
 *
 * Initialisation PARESSEUSE : si STRIPE_SECRET_KEY est absente, ce module
 * s'importe quand même (le build et les pages publiques continuent de
 * fonctionner) et une erreur explicite n'est levée qu'au moment d'un appel réel
 * à Stripe. Créer l'instance au chargement du module casserait le build tant
 * que la clé n'est pas renseignée.
 */

let cached: Stripe | null = null;

/** La clé secrète Stripe est-elle configurée ? */
export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Retourne l'instance Stripe configurée (créée à la première utilisation). */
export function getStripe(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY n'est pas configurée. Ajoutez une clé de test (sk_test_…) dans .env, puis redémarrez le serveur.",
    );
  }
  if (!cached) {
    cached = new Stripe(secretKey);
  }
  return cached;
}

/* -------------------------------------------------------------------------- */
/* Helpers de l'espace abonné (WP7d)                                          */
/* -------------------------------------------------------------------------- */

/**
 * URL de la facture hébergée par Stripe, ou null si elle n'est pas disponible.
 * Utilisé pour rattraper les paiements enregistrés avant l'ajout de
 * `Payment.invoiceUrl`.
 */
export async function getInvoiceUrl(invoiceId: string): Promise<string | null> {
  const invoice = await getStripe().invoices.retrieve(invoiceId);
  return invoice.hosted_invoice_url ?? null;
}

/**
 * Session du portail de facturation Stripe (gestion de l'abonnement, moyens de
 * paiement, factures).
 */
export async function createBillingPortalSessionUrl(
  customerId: string,
  returnUrl: string,
): Promise<string> {
  const portal = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return portal.url;
}

/**
 * Programme (ou annule) la résiliation d'un abonnement en fin de période.
 * `cancelAtPeriodEnd: true` = annulation demandée ; `false` = réactivation.
 */
export async function setSubscriptionCancelAtPeriodEnd(
  stripeSubscriptionId: string,
  cancelAtPeriodEnd: boolean,
): Promise<void> {
  await getStripe().subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });
}
