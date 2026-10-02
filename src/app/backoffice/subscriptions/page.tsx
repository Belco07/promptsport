import Link from "next/link";

import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";
import {
  PAYMENT_STATUS_BADGES,
  PAYMENT_STATUS_LABELS,
  PLAN_INTERVAL_LABELS,
  SUBSCRIPTION_STATUS_BADGES,
  SUBSCRIPTION_STATUS_LABELS,
  formatPrice,
  monthlyRecurringCents,
} from "@/lib/subscription-utils";

/**
 * Administration des abonnements (WP7a, enrichie au WP7e) : consultation des
 * plans et paiements, et gestion complète des abonnements (filtres, recherche,
 * pagination, détail, annulation, remboursement).
 */

export const dynamic = "force-dynamic";

const TABS = [
  { id: "plans", label: "Plans" },
  { id: "subscriptions", label: "Abonnements" },
  { id: "payments", label: "Paiements" },
];

const STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
const PAGE_SIZE = 20;

const thClass = "px-4 py-3 font-semibold";
const tdClass = "px-4 py-3";
const inputClass =
  "rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";

type SearchParams = {
  tab?: string;
  statut?: string;
  plan?: string;
  q?: string;
  page?: string;
  resultat?: string;
  erreur?: string;
};

function Empty({ label }: { label: string }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
      {label}
    </p>
  );
}

function Banner({ resultat, erreur }: { resultat?: string; erreur?: string }) {
  if (!resultat && !erreur) return null;
  const success =
    resultat === "annule"
      ? "Abonnement annulé en fin de période."
      : resultat === "rembourse"
        ? "Paiement remboursé."
        : null;
  const error = erreur
    ? `Action impossible : ${
        erreur === "paiement-sans-intent"
          ? "ce paiement n'a pas d'intent de paiement Stripe."
          : erreur === "sans-abonnement-stripe"
            ? "cet abonnement n'est pas rattaché à Stripe (plan à vie)."
            : erreur === "stripe-non-configure"
              ? "Stripe n'est pas configuré."
              : decodeURIComponent(erreur)
      }`
    : null;

  return (
    <div className="mb-6 space-y-2">
      {success ? (
        <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {success}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const activeTab = TABS.some((t) => t.id === params.tab) ? (params.tab as string) : "plans";

  const status = STATUSES.includes(params.statut as (typeof STATUSES)[number])
    ? (params.statut as (typeof STATUSES)[number])
    : undefined;
  const planId = params.plan?.trim() || undefined;
  const query = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const [plans, payments] = await Promise.all([
    prisma.plan.findMany({
      orderBy: { price: "asc" },
      include: { _count: { select: { subscriptions: true } } },
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  // Filtres de la liste d'abonnements.
  const where = {
    ...(status ? { status } : {}),
    ...(planId ? { planId } : {}),
    ...(query ? { user: { email: { contains: query } } } : {}),
  };

  const [subscriptions, subscriptionCount] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        user: { select: { name: true, email: true } },
        plan: { select: { name: true, price: true, interval: true, currency: true } },
      },
    }),
    prisma.subscription.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(subscriptionCount / PAGE_SIZE));

  /** Conserve les filtres dans les liens de pagination. */
  const pageHref = (targetPage: number) => {
    const search = new URLSearchParams({ tab: "subscriptions" });
    if (status) search.set("statut", status);
    if (planId) search.set("plan", planId);
    if (query) search.set("q", query);
    if (targetPage > 1) search.set("page", String(targetPage));
    return `/backoffice/subscriptions?${search.toString()}`;
  };

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">Abonnements</h1>

      <Banner resultat={params.resultat} erreur={params.erreur} />

      <nav className="mb-6 flex gap-2 border-b border-gray-200">
        {TABS.map((t) => {
          const isActive = t.id === activeTab;
          return (
            <Link
              key={t.id}
              href={`/backoffice/subscriptions?tab=${t.id}`}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-blue-700 text-blue-700"
                  : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {activeTab === "plans" ? (
        plans.length === 0 ? (
          <Empty label="Aucun plan. Créez-en un via Prisma Studio." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className={thClass}>Nom</th>
                  <th className={thClass}>Prix</th>
                  <th className={thClass}>Intervalle</th>
                  <th className={thClass}>Actif</th>
                  <th className={thClass}>Abonnés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-gray-50">
                    <td className={`${tdClass} font-medium text-gray-900`}>
                      {plan.name}
                      <span className="block text-xs font-normal text-gray-400">/{plan.slug}</span>
                    </td>
                    <td className={`${tdClass} text-gray-900`}>
                      {formatPrice(plan.price, plan.currency)}
                    </td>
                    <td className={`${tdClass} text-gray-700`}>
                      {PLAN_INTERVAL_LABELS[plan.interval] ?? plan.interval}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          plan.active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {plan.active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className={`${tdClass} text-gray-600`}>{plan._count.subscriptions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {activeTab === "subscriptions" ? (
        <>
          <form method="get" action="/backoffice/subscriptions" className="mb-5 flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="subscriptions" />

            <div>
              <label htmlFor="statut" className="mb-1 block text-xs font-medium text-gray-600">
                Statut
              </label>
              <select id="statut" name="statut" defaultValue={status ?? ""} className={inputClass}>
                <option value="">Tous les statuts</option>
                {STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {SUBSCRIPTION_STATUS_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="plan" className="mb-1 block text-xs font-medium text-gray-600">
                Plan
              </label>
              <select id="plan" name="plan" defaultValue={planId ?? ""} className={inputClass}>
                <option value="">Tous les plans</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="q" className="mb-1 block text-xs font-medium text-gray-600">
                E-mail de l&apos;utilisateur
              </label>
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={query ?? ""}
                placeholder="exemple@domaine.fr"
                className={inputClass}
              />
            </div>

            <button
              type="submit"
              className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
            >
              Filtrer
            </button>
            <Link
              href="/backoffice/subscriptions?tab=subscriptions"
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
            >
              Réinitialiser
            </Link>
          </form>

          <p className="mb-3 text-sm text-gray-600">
            {subscriptionCount} abonnement{subscriptionCount > 1 ? "s" : ""} — page {page} sur{" "}
            {pageCount}
          </p>

          {subscriptions.length === 0 ? (
            <Empty label="Aucun abonnement ne correspond à ces critères." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className={thClass}>Utilisateur</th>
                    <th className={thClass}>Plan</th>
                    <th className={thClass}>Statut</th>
                    <th className={thClass}>Fin de période</th>
                    <th className={thClass}>MRR</th>
                    <th className={thClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {subscriptions.map((subscription) => {
                    const detailHref = `/backoffice/subscriptions/${subscription.id}`;
                    const isActive = subscription.status === "ACTIVE";
                    return (
                      <tr key={subscription.id} className="hover:bg-gray-50">
                        <td className={`${tdClass} font-medium text-gray-900`}>
                          {subscription.user.name}
                          <span className="block text-xs font-normal text-gray-400">
                            {subscription.user.email}
                          </span>
                        </td>
                        <td className={`${tdClass} text-gray-700`}>
                          {subscription.plan.name}
                          <span className="block text-xs text-gray-400">
                            {formatPrice(subscription.plan.price, subscription.plan.currency)}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              SUBSCRIPTION_STATUS_BADGES[subscription.status] ??
                              "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
                          </span>
                          {subscription.cancelAtPeriodEnd ? (
                            <span className="mt-1 block text-xs text-amber-700">
                              résiliation programmée
                            </span>
                          ) : null}
                        </td>
                        <td className={`${tdClass} text-gray-600`}>
                          <time dateTime={subscription.currentPeriodEnd.toISOString()}>
                            {formatDate(subscription.currentPeriodEnd)}
                          </time>
                        </td>
                        <td className={`${tdClass} text-gray-900`}>
                          {isActive
                            ? formatPrice(monthlyRecurringCents(subscription.plan), "EUR")
                            : "—"}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap`}>
                          <Link href={detailHref} className="text-blue-700 underline hover:text-blue-900">
                            Voir le détail
                          </Link>
                          <span className="mx-2 text-gray-300">|</span>
                          <Link
                            href={`${detailHref}?confirmer=annuler`}
                            className="text-red-700 underline hover:text-red-900"
                          >
                            Annuler
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {pageCount > 1 ? (
            <nav className="mt-5 flex items-center justify-between text-sm">
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="text-blue-700 underline hover:text-blue-900">
                  ← Page précédente
                </Link>
              ) : (
                <span className="text-gray-400">← Page précédente</span>
              )}
              {page < pageCount ? (
                <Link href={pageHref(page + 1)} className="text-blue-700 underline hover:text-blue-900">
                  Page suivante →
                </Link>
              ) : (
                <span className="text-gray-400">Page suivante →</span>
              )}
            </nav>
          ) : null}
        </>
      ) : null}

      {activeTab === "payments" ? (
        payments.length === 0 ? (
          <Empty label="Aucun paiement. Créez-en un via Prisma Studio." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className={thClass}>Utilisateur</th>
                  <th className={thClass}>Montant</th>
                  <th className={thClass}>Statut</th>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>ID Stripe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className={`${tdClass} font-medium text-gray-900`}>
                      {payment.user.name}
                      <span className="block text-xs font-normal text-gray-400">
                        {payment.user.email}
                      </span>
                    </td>
                    <td className={`${tdClass} text-gray-900`}>
                      {formatPrice(payment.amount, payment.currency)}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          PAYMENT_STATUS_BADGES[payment.status] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                      </span>
                    </td>
                    <td className={`${tdClass} text-gray-600`}>
                      {payment.paidAt ? (
                        <time dateTime={payment.paidAt.toISOString()}>
                          {formatDate(payment.paidAt)}
                        </time>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`${tdClass} font-mono text-xs text-gray-500`}>
                      {payment.stripePaymentIntentId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  );
}
