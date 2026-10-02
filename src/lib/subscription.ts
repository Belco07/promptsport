import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getInvoiceUrl, isStripeConfigured } from "@/lib/stripe";
import { computeMrrCents, countActiveSubscriptions } from "@/lib/subscription-utils";

/**
 * Abonnements : accès premium (WP7c), espace abonné (WP7d), journal des
 * événements et métriques (WP7e).
 */

/** Types d'événements du journal (miroir de l'enum Prisma). */
export type SubscriptionEventKind =
  | "CREATED"
  | "ACTIVATED"
  | "RENEWED"
  | "CANCELED"
  | "REACTIVATED"
  | "PAST_DUE"
  | "EXPIRED"
  | "REFUNDED";

/**
 * Journalise un changement de statut d'abonnement.
 *
 * Best-effort : un échec d'écriture ne doit jamais faire échouer un webhook
 * Stripe ni une action utilisateur.
 */
export async function recordSubscriptionEvent(
  subscriptionId: string,
  type: SubscriptionEventKind,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.subscriptionEvent.create({
      data: {
        subscriptionId,
        type,
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });
  } catch {
    // Le journal ne doit jamais bloquer le flux métier.
  }
}

/** Événements d'un abonnement, du plus récent au plus ancien. */
export async function getSubscriptionEvents(subscriptionId: string, take = 50) {
  return prisma.subscriptionEvent.findMany({
    where: { subscriptionId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Vrai si l'utilisateur possède un abonnement ACTIVE dont la période de
 * facturation n'est pas terminée.
 *
 * Le statut fait foi : un abonnement CANCELED ou EXPIRED ne donne pas accès au
 * contenu premium, même si `currentPeriodEnd` est encore dans le futur. Le plan
 * à vie est couvert par une échéance lointaine (voir WP7b).
 */
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      currentPeriodEnd: { gt: new Date() },
    },
    select: { id: true },
  });

  return subscription !== null;
}

/**
 * Abonnement en cours d'un utilisateur (le plus récent), avec son plan.
 *
 * Retourne null s'il n'a aucun abonnement ACTIVE non expiré : un abonnement
 * CANCELED ou EXPIRED n'est pas « en cours ». `cancelAtPeriodEnd` distingue une
 * résiliation programmée (accès conservé jusqu'à l'échéance) d'un abonnement
 * qui se renouvelle.
 */
export async function getActiveSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: {
      userId,
      status: "ACTIVE",
      currentPeriodEnd: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

/** Dernier abonnement connu, quel que soit son statut (pour l'historique). */
export async function getLatestSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

/** Paiements d'un utilisateur, du plus récent au plus ancien. */
export async function getUserPayments(userId: string, take = 10) {
  return prisma.payment.findMany({
    where: { userId },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take,
  });
}

/**
 * Complète les URL de facture manquantes.
 *
 * Les paiements enregistrés avant le WP7d n'ont pas de `invoiceUrl` : on la
 * récupère une fois auprès de Stripe, puis on la mémorise. Best-effort : une
 * erreur Stripe ne doit jamais empêcher l'affichage de l'historique.
 */
export async function withInvoiceUrls<T extends { id: string; stripeInvoiceId: string | null; invoiceUrl: string | null }>(
  payments: T[],
): Promise<T[]> {
  if (!isStripeConfigured()) return payments;

  return Promise.all(
    payments.map(async (payment) => {
      if (payment.invoiceUrl || !payment.stripeInvoiceId) return payment;
      try {
        const url = await getInvoiceUrl(payment.stripeInvoiceId);
        if (!url) return payment;
        await prisma.payment.update({ where: { id: payment.id }, data: { invoiceUrl: url } });
        return { ...payment, invoiceUrl: url };
      } catch {
        return payment;
      }
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Métriques d'administration (WP7e)                                          */
/* -------------------------------------------------------------------------- */

export type SubscriptionMetrics = {
  activeSubscribers: number;
  mrrCents: number;
  newThisMonth: number;
  churnedThisMonth: number;
  /**
   * Taux de churn du mois, en pourcentage.
   *
   * « Abonnements annulés ce mois-ci / abonnements actifs au début du mois ».
   * La base de départ est approchée par les abonnements créés avant le mois et
   * non résiliés avant son début ; sans base (tout est nouveau), le taux vaut 0
   * plutôt que 100 %, ce qui serait trompeur.
   */
  churnRatePercent: number;
};

/** Début du mois en cours (UTC). */
export function getMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function getSubscriptionMetrics(): Promise<SubscriptionMetrics> {
  const monthStart = getMonthStart();

  const [subscriptions, newThisMonth, canceledEvents, baseAtMonthStart] = await Promise.all([
    prisma.subscription.findMany({
      select: { status: true, plan: { select: { price: true, interval: true } } },
    }),
    prisma.subscription.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.subscriptionEvent.findMany({
      where: { type: "CANCELED", createdAt: { gte: monthStart } },
      select: { subscriptionId: true },
    }),
    prisma.subscription.count({
      where: {
        createdAt: { lt: monthStart },
        OR: [{ canceledAt: null }, { canceledAt: { gte: monthStart } }],
      },
    }),
  ]);

  const churnedSubscriptions = new Set(canceledEvents.map((event) => event.subscriptionId)).size;
  const churnRatePercent =
    baseAtMonthStart > 0
      ? Math.round((churnedSubscriptions / baseAtMonthStart) * 1000) / 10
      : 0;

  return {
    activeSubscribers: countActiveSubscriptions(subscriptions),
    mrrCents: computeMrrCents(subscriptions),
    newThisMonth,
    churnedThisMonth: churnedSubscriptions,
    churnRatePercent,
  };
}

