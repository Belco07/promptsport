import Link from "next/link";
import { notFound } from "next/navigation";

import { SubscriptionTimeline } from "@/components/SubscriptionTimeline";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";
import { getSubscriptionEvents } from "@/lib/subscription";
import {
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  PLAN_INTERVAL_LABELS,
  SUBSCRIPTION_STATUS_BADGES,
  SUBSCRIPTION_STATUS_LABELS,
  formatPrice,
  monthlyRecurringCents,
} from "@/lib/subscription-utils";

import { adminCancelSubscription, adminRefundPayment } from "../actions";

/**
 * Détail d'un abonnement (WP7e) : identité, dates, identifiants Stripe,
 * journal des événements et actions d'administration (annulation, remboursement).
 */

export const dynamic = "force-dynamic";

const BASE = "/backoffice/subscriptions";

const inputClass = "hidden";

function errorMessageFor(erreur: string): string {
  switch (erreur) {
    case "paiement-sans-intent":
      return "Ce paiement n'a pas d'intent de paiement Stripe : remboursement impossible.";
    case "sans-abonnement-stripe":
      return "Cet abonnement n'est pas rattaché à Stripe (plan à vie) : rien à annuler côté Stripe.";
    case "stripe-non-configure":
      return "Stripe n'est pas configuré sur ce site.";
    case "paiement-introuvable":
      return "Paiement introuvable.";
    default:
      return `Action impossible : ${decodeURIComponent(erreur)}`;
  }
}

export default async function SubscriptionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ confirmer?: string; paiement?: string; resultat?: string; erreur?: string }>;
}) {
  const { id } = await params;
  const { confirmer, paiement, resultat, erreur } = await searchParams;

  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true, stripeCustomerId: true } },
      plan: true,
      payments: { orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }] },
    },
  });

  if (!subscription) {
    notFound();
  }

  const events = await getSubscriptionEvents(subscription.id);
  const detailPath = `${BASE}/${subscription.id}`;
  const canCancel = subscription.status === "ACTIVE" && Boolean(subscription.stripeSubscriptionId);
  const dashboardBase = "https://dashboard.stripe.com/test";
  const refundTarget = paiement
    ? subscription.payments.find((payment) => payment.id === paiement)
    : undefined;

  return (
    <div className="px-8 py-10">
      <Link
        href={`${BASE}?tab=subscriptions`}
        className="mb-6 inline-block text-sm text-blue-700 underline hover:text-blue-900"
      >
        ← Retour à la liste des abonnements
      </Link>

      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        Abonnement de {subscription.user.name}
      </h1>
      <p className="mt-1 text-sm text-gray-600">{subscription.user.email}</p>

      {resultat === "annule" ? (
        <p role="status" className="mt-6 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Abonnement annulé en fin de période.
        </p>
      ) : null}
      {resultat === "rembourse" ? (
        <p role="status" className="mt-6 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Paiement remboursé et paiement marqué comme remboursé.
        </p>
      ) : null}
      {erreur ? (
        <p role="alert" className="mt-6 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessageFor(erreur)}
        </p>
      ) : null}

      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Informations</h2>

        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-gray-500">Plan</dt>
            <dd className="font-medium text-gray-900">
              {subscription.plan.name} — {formatPrice(subscription.plan.price, subscription.plan.currency)}
              {` (${PLAN_INTERVAL_LABELS[subscription.plan.interval] ?? subscription.plan.interval})`}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Statut</dt>
            <dd>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  SUBSCRIPTION_STATUS_BADGES[subscription.status] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
              </span>
              {subscription.cancelAtPeriodEnd ? (
                <span className="ml-2 text-xs text-amber-700">résiliation programmée</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">MRR</dt>
            <dd className="font-medium text-gray-900">
              {subscription.status === "ACTIVE"
                ? formatPrice(monthlyRecurringCents(subscription.plan), "EUR")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Créé le</dt>
            <dd className="font-medium text-gray-900">{formatDate(subscription.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Période en cours</dt>
            <dd className="font-medium text-gray-900">
              {formatDate(subscription.currentPeriodStart)} → {formatDate(subscription.currentPeriodEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Résilié le</dt>
            <dd className="font-medium text-gray-900">
              {subscription.canceledAt ? formatDate(subscription.canceledAt) : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-gray-500">Identifiants Stripe</dt>
            <dd className="mt-1 space-y-1 font-mono text-xs text-gray-600">
              <p>abonnement : {subscription.stripeSubscriptionId ?? "—"}</p>
              <p>client : {subscription.stripeCustomerId ?? subscription.user.stripeCustomerId ?? "—"}</p>
              <p>session : {subscription.stripeSessionId ?? "—"}</p>
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
          {subscription.stripeSubscriptionId ? (
            <a
              href={`${dashboardBase}/subscriptions/${subscription.stripeSubscriptionId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
            >
              Voir dans Stripe
            </a>
          ) : null}
          {canCancel ? (
            <Link
              href={`${detailPath}?confirmer=annuler`}
              className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50"
            >
              Annuler
            </Link>
          ) : null}
        </div>

        {confirmer === "annuler" && canCancel ? (
          <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-900">
              Confirmer l&apos;annulation de cet abonnement ?
            </p>
            <p className="mt-1 text-sm text-red-800">
              L&apos;abonné conservera l&apos;accès jusqu&apos;au{" "}
              {formatDate(subscription.currentPeriodEnd)}, puis l&apos;abonnement s&apos;arrêtera.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <form action={adminCancelSubscription}>
                <input className={inputClass} type="hidden" name="subscriptionId" value={subscription.id} />
                <button
                  type="submit"
                  className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800"
                >
                  Oui, annuler en fin de période
                </button>
              </form>
              <Link
                href={detailPath}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
              >
                Renoncer
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Historique des événements</h2>
        <div className="mt-5">
          <SubscriptionTimeline
            events={events}
            emptyLabel="Aucun événement enregistré pour cet abonnement."
          />
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Paiements</h2>

        {subscription.payments.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">Aucun paiement pour cet abonnement.</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Montant</th>
                  <th className="py-2 pr-4 font-medium">Statut</th>
                  <th className="py-2 pr-4 font-medium">Facture</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subscription.payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="py-3 pr-4 text-gray-900">
                      {formatDate(payment.paidAt ?? payment.createdAt)}
                    </td>
                    <td className="py-3 pr-4 font-medium text-gray-900">
                      {formatPrice(payment.amount, payment.currency)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          PAYMENT_STATUS_BADGES[payment.status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {payment.invoiceUrl ? (
                        <a
                          href={payment.invoiceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-700 underline hover:text-blue-900"
                        >
                          Voir la facture
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 whitespace-nowrap">
                      {payment.status === "SUCCEEDED" && payment.stripePaymentIntentId ? (
                        <Link
                          href={`${detailPath}?confirmer=rembourser&paiement=${payment.id}`}
                          className="text-amber-700 underline hover:text-amber-900"
                        >
                          Rembourser
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {confirmer === "rembourser" ? (
          refundTarget ? (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                Confirmer le remboursement de {formatPrice(refundTarget.amount, refundTarget.currency)} ?
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Le remboursement est effectué immédiatement dans Stripe (mode test) et le paiement
                sera marqué comme remboursé.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <form action={adminRefundPayment}>
                  <input className={inputClass} type="hidden" name="paymentId" value={refundTarget.id} />
                  <button
                    type="submit"
                    className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
                  >
                    Oui, rembourser
                  </button>
                </form>
                <Link
                  href={detailPath}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
                >
                  Renoncer
                </Link>
              </div>
            </div>
          ) : (
            <p role="alert" className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Paiement introuvable pour ce remboursement.
            </p>
          )
        ) : null}
      </section>
    </div>
  );
}
