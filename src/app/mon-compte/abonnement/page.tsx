import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SubscriptionStatus } from "@/components/SubscriptionStatus";
import { SubscriptionTimeline } from "@/components/SubscriptionTimeline";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/formatDate";
import {
  getActiveSubscription,
  getLatestSubscription,
  getSubscriptionEvents,
} from "@/lib/subscription";
import {
  SUBSCRIPTION_STATUS_LABELS,
  formatPrice,
} from "@/lib/subscription-utils";

/**
 * Détail de l'abonnement (WP7d) : formule, dates, statut et journal réel des
 * événements (WP7e). Page protégée : un visiteur non connecté est redirigé.
 */

export const metadata: Metadata = {
  title: "Mon abonnement — Mon Site d'Actualités",
  description: "Le détail de votre abonnement et son historique.",
};

export const dynamic = "force-dynamic";

const PRICE_SUFFIX: Record<string, string> = {
  MONTH: " / mois",
  YEAR: " / an",
  LIFETIME: " (à vie)",
};

export default async function AccountSubscriptionPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const activeSubscription = await getActiveSubscription(session.user.id);
  // À défaut d'abonnement en cours, on montre le dernier connu (résilié, expiré).
  const subscription = activeSubscription ?? (await getLatestSubscription(session.user.id));
  const events = subscription ? await getSubscriptionEvents(subscription.id) : [];

  const subscriptionData = activeSubscription
    ? {
        planName: activeSubscription.plan.name,
        priceLabel: `${formatPrice(activeSubscription.plan.price, activeSubscription.plan.currency)}${
          PRICE_SUFFIX[activeSubscription.plan.interval] ?? ""
        }`,
        periodStartLabel: formatDate(activeSubscription.currentPeriodStart),
        periodEndLabel: formatDate(activeSubscription.currentPeriodEnd),
        cancelAtPeriodEnd: activeSubscription.cancelAtPeriodEnd,
      }
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/mon-compte"
        className="mb-8 inline-block text-sm text-blue-700 underline transition-colors hover:text-blue-900"
      >
        ← Retour à mon compte
      </Link>

      <h1 className="text-3xl font-bold tracking-tight text-gray-900">Mon abonnement</h1>
      <p className="mt-2 text-sm text-gray-600">
        Formule, dates et historique de votre abonnement.
      </p>

      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        {subscription && !activeSubscription ? (
          <div className="mb-5 space-y-2">
            <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              Cet abonnement n&apos;est plus actif (statut :{" "}
              {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
              {subscription.canceledAt
                ? `, résilié le ${formatDate(subscription.canceledAt)}`
                : ""}
              ).
            </p>
            <p className="text-sm text-gray-600">
              Vous n&apos;avez pas d&apos;abonnement actif.
            </p>
          </div>
        ) : null}

        <SubscriptionStatus subscription={subscriptionData} showPeriod />

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          <Link
            href="/abonnement"
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
          >
            Changer de plan
          </Link>
          {subscription?.stripeSubscriptionId ? (
            <p className="text-xs text-gray-500">
              Référence Stripe : <span className="font-mono">{subscription.stripeSubscriptionId}</span>
            </p>
          ) : null}
        </div>
      </section>

      {subscription ? (
        <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Détail de la formule</h2>
          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-gray-500">Formule</dt>
              <dd className="font-medium text-gray-900">{subscription.plan.name}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Prix</dt>
              <dd className="font-medium text-gray-900">
                {formatPrice(subscription.plan.price, subscription.plan.currency)}
                {PRICE_SUFFIX[subscription.plan.interval] ?? ""}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Statut</dt>
              <dd className="font-medium text-gray-900">
                {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
                {subscription.cancelAtPeriodEnd ? " (résiliation programmée)" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Souscrit le</dt>
              <dd className="font-medium text-gray-900">{formatDate(subscription.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Début de la période</dt>
              <dd className="font-medium text-gray-900">
                {formatDate(subscription.currentPeriodStart)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Fin de la période</dt>
              <dd className="font-medium text-gray-900">
                {formatDate(subscription.currentPeriodEnd)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Historique des événements</h2>
        <div className="mt-5">
          <SubscriptionTimeline
            events={events}
            emptyLabel="Aucun événement enregistré pour le moment."
          />
        </div>
      </section>
    </main>
  );
}
