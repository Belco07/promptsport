/**
 * Helpers de formatage et de calcul pour les abonnements (WP7a).
 */

export const PLAN_INTERVAL_LABELS: Record<string, string> = {
  MONTH: "Mensuel",
  YEAR: "Annuel",
  LIFETIME: "À vie",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  TRIALING: "Essai",
  PAST_DUE: "Impayé",
  CANCELED: "Annulé",
  EXPIRED: "Expiré",
};

export const SUBSCRIPTION_STATUS_BADGES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  TRIALING: "bg-blue-100 text-blue-800",
  PAST_DUE: "bg-orange-100 text-orange-800",
  CANCELED: "bg-gray-100 text-gray-600",
  EXPIRED: "bg-red-100 text-red-800",
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  SUCCEEDED: "Réussi",
  FAILED: "Échoué",
  REFUNDED: "Remboursé",
};

export const PAYMENT_STATUS_BADGES: Record<string, string> = {
  SUCCEEDED: "bg-green-100 text-green-800",
  PENDING: "bg-gray-100 text-gray-600",
  FAILED: "bg-red-100 text-red-800",
  REFUNDED: "bg-orange-100 text-orange-800",
};

/** Formate un montant en centimes (« 999 » → « 9,99 € »). */
export function formatPrice(cents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

type PlanLike = { price: number; interval: string };

/**
 * Montant mensuel récurrent d'un plan, en centimes.
 * Un plan annuel est ramené au mois ; un plan à vie ne génère pas de récurrent.
 */
export function monthlyRecurringCents(plan: PlanLike): number {
  switch (plan.interval) {
    case "MONTH":
      return plan.price;
    case "YEAR":
      return Math.round(plan.price / 12);
    case "LIFETIME":
      return 0;
    default:
      return 0;
  }
}

type SubscriptionLike = { status: string; plan: PlanLike };

/** Nombre d'abonnements actifs. */
export function countActiveSubscriptions(subscriptions: SubscriptionLike[]): number {
  return subscriptions.filter((s) => s.status === "ACTIVE").length;
}

/** Revenu mensuel récurrent (MRR) des abonnements actifs, en centimes. */
export function computeMrrCents(subscriptions: SubscriptionLike[]): number {
  return subscriptions
    .filter((s) => s.status === "ACTIVE")
    .reduce((total, s) => total + monthlyRecurringCents(s.plan), 0);
}

/**
 * Revenu annuel récurrent (ARR) des abonnements actifs, en centimes.
 *
 * Calculé sur l'intervalle réel de chaque plan, et non « MRR × 12 » : ce
 * dernier arrondirait les plans annuels au mois (1000 centimes par an donnent
 * 83 centimes de MRR, soit 996 en ARR au lieu de 1000).
 */
export function computeArrCents(subscriptions: SubscriptionLike[]): number {
  return subscriptions
    .filter((s) => s.status === "ACTIVE")
    .reduce((total, s) => {
      switch (s.plan.interval) {
        case "MONTH":
          return total + s.plan.price * 12;
        case "YEAR":
          return total + s.plan.price;
        default:
          // Paiement unique (à vie) : aucun revenu récurrent.
          return total;
      }
    }, 0);
}

type PaymentLike = { amount: number; status: string };

/**
 * Total encaissé (centimes) : somme des paiements réussis, abonnements et
 * achats uniques confondus — c'est le seul indicateur qui voit passer un plan
 * à vie, absent du MRR et de l'ARR.
 */
export function computeTotalPaidCents(payments: PaymentLike[]): number {
  return payments
    .filter((p) => p.status === "SUCCEEDED")
    .reduce((total, p) => total + p.amount, 0);
}
