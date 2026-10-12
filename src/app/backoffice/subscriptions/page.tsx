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
  "rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-editorial-link focus:ring-1 focus:ring-blue-600";

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
    <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
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
        <p role="status" className="rounded-md border border-status-success-border bg-status-success px-3 py-2 text-sm text-status-success-foreground">
          {success}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground">
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
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">Abonnements</h1>

      <Banner resultat={params.resultat} erreur={params.erreur} />

      <nav className="mb-6 flex gap-2 border-b border-border">
        {TABS.map((t) => {
          const isActive = t.id === activeTab;
          return (
            <Link
              key={t.id}
              href={`/backoffice/subscriptions?tab=${t.id}`}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-editorial-link text-editorial-link"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
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
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className={thClass}>Nom</th>
                  <th className={thClass}>Prix</th>
                  <th className={thClass}>Intervalle</th>
                  <th className={thClass}>Actif</th>
                  <th className={thClass}>Abonnés</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {plans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-muted">
                    <td className={`${tdClass} font-medium text-foreground`}>
                      {plan.name}
                      <span className="block text-xs font-normal text-muted-foreground">/{plan.slug}</span>
                    </td>
                    <td className={`${tdClass} text-foreground`}>
                      {formatPrice(plan.price, plan.currency)}
                    </td>
                    <td className={`${tdClass} text-foreground`}>
                      {PLAN_INTERVAL_LABELS[plan.interval] ?? plan.interval}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          plan.active ? "bg-status-success text-status-success-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {plan.active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className={`${tdClass} text-muted-foreground`}>{plan._count.subscriptions}</td>
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
              <label htmlFor="statut" className="mb-1 block text-xs font-medium text-muted-foreground">
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
              <label htmlFor="plan" className="mb-1 block text-xs font-medium text-muted-foreground">
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
              <label htmlFor="q" className="mb-1 block text-xs font-medium text-muted-foreground">
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
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
            >
              Filtrer
            </button>
            <Link
              href="/backoffice/subscriptions?tab=subscriptions"
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Réinitialiser
            </Link>
          </form>

          <p className="mb-3 text-sm text-muted-foreground">
            {subscriptionCount} abonnement{subscriptionCount > 1 ? "s" : ""} — page {page} sur{" "}
            {pageCount}
          </p>

          {subscriptions.length === 0 ? (
            <Empty label="Aucun abonnement ne correspond à ces critères." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className={thClass}>Utilisateur</th>
                    <th className={thClass}>Plan</th>
                    <th className={thClass}>Statut</th>
                    <th className={thClass}>Fin de période</th>
                    <th className={thClass}>MRR</th>
                    <th className={thClass}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {subscriptions.map((subscription) => {
                    const detailHref = `/backoffice/subscriptions/${subscription.id}`;
                    const isActive = subscription.status === "ACTIVE";
                    return (
                      <tr key={subscription.id} className="hover:bg-muted">
                        <td className={`${tdClass} font-medium text-foreground`}>
                          {subscription.user.name}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {subscription.user.email}
                          </span>
                        </td>
                        <td className={`${tdClass} text-foreground`}>
                          {subscription.plan.name}
                          <span className="block text-xs text-muted-foreground">
                            {formatPrice(subscription.plan.price, subscription.plan.currency)}
                          </span>
                        </td>
                        <td className={tdClass}>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              SUBSCRIPTION_STATUS_BADGES[subscription.status] ??
                              "bg-muted text-muted-foreground"
                            }`}
                          >
                            {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
                          </span>
                          {subscription.cancelAtPeriodEnd ? (
                            <span className="mt-1 block text-xs text-status-warning-foreground">
                              résiliation programmée
                            </span>
                          ) : null}
                        </td>
                        <td className={`${tdClass} text-muted-foreground`}>
                          <time dateTime={subscription.currentPeriodEnd.toISOString()}>
                            {formatDate(subscription.currentPeriodEnd)}
                          </time>
                        </td>
                        <td className={`${tdClass} text-foreground`}>
                          {isActive
                            ? formatPrice(monthlyRecurringCents(subscription.plan), "EUR")
                            : "—"}
                        </td>
                        <td className={`${tdClass} whitespace-nowrap`}>
                          <Link href={detailHref} className="text-editorial-link underline hover:text-editorial-link">
                            Voir le détail
                          </Link>
                          <span className="mx-2 text-gray-300">|</span>
                          <Link
                            href={`${detailHref}?confirmer=annuler`}
                            className="text-status-error-foreground underline hover:text-status-error-foreground"
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
                <Link href={pageHref(page - 1)} className="text-editorial-link underline hover:text-editorial-link">
                  ← Page précédente
                </Link>
              ) : (
                <span className="text-muted-foreground">← Page précédente</span>
              )}
              {page < pageCount ? (
                <Link href={pageHref(page + 1)} className="text-editorial-link underline hover:text-editorial-link">
                  Page suivante →
                </Link>
              ) : (
                <span className="text-muted-foreground">Page suivante →</span>
              )}
            </nav>
          ) : null}
        </>
      ) : null}

      {activeTab === "payments" ? (
        payments.length === 0 ? (
          <Empty label="Aucun paiement. Créez-en un via Prisma Studio." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className={thClass}>Utilisateur</th>
                  <th className={thClass}>Montant</th>
                  <th className={thClass}>Statut</th>
                  <th className={thClass}>Date</th>
                  <th className={thClass}>ID Stripe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-muted">
                    <td className={`${tdClass} font-medium text-foreground`}>
                      {payment.user.name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {payment.user.email}
                      </span>
                    </td>
                    <td className={`${tdClass} text-foreground`}>
                      {formatPrice(payment.amount, payment.currency)}
                    </td>
                    <td className={tdClass}>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          PAYMENT_STATUS_BADGES[payment.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                      </span>
                    </td>
                    <td className={`${tdClass} text-muted-foreground`}>
                      {payment.paidAt ? (
                        <time dateTime={payment.paidAt.toISOString()}>
                          {formatDate(payment.paidAt)}
                        </time>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={`${tdClass} font-mono text-xs text-muted-foreground`}>
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
