import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SubscriptionStatus } from "@/components/SubscriptionStatus";
import { SubscriptionTimeline } from "@/components/SubscriptionTimeline";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/formatDate";
import {
  getActiveSubscription,
  getLatestSubscription,
  getSubscriptionEvents,
  getUserPayments,
  withInvoiceUrls,
} from "@/lib/subscription";
import {
  PAYMENT_STATUS_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  formatPrice,
} from "@/lib/subscription-utils";

/**
 * Détail de l'abonnement (WP7d) : formule, dates, statut, journal réel des
 * événements (WP7e) et historique des paiements, déplacé ici depuis la page
 * « Détails du compte » qui ne garde que le profil. Page protégée.
 */

export const metadata: Metadata = {
  title: "Mon abonnement",
  description: "Le détail de votre abonnement et son historique.",
};

export const dynamic = "force-dynamic";

const PRICE_SUFFIX: Record<string, string> = {
  MONTH: " / mois",
  YEAR: " / an",
  LIFETIME: " (à vie)",
};

/** Teinte du badge de statut de paiement, sur la palette du design system. */
const PAYMENT_TONES: Record<string, BadgeTone> = {
  SUCCEEDED: "success",
  PENDING: "neutral",
  FAILED: "danger",
  REFUNDED: "accent",
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
  // Historique des paiements (déplacé depuis /mon-compte).
  const payments = await withInvoiceUrls(await getUserPayments(session.user.id, 10));

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
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link
        href="/mon-compte"
        className="mb-8 inline-block text-sm text-editorial-link underline transition-colors hover:text-editorial-link"
      >
        ← Retour à mon compte
      </Link>

      <h1 className="text-3xl font-bold tracking-tight text-foreground">Mon abonnement</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Formule, dates et historique de votre abonnement.
      </p>

      <section className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
        {subscription && !activeSubscription ? (
          <div className="mb-5 space-y-2">
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
              Cet abonnement n&apos;est plus actif (statut :{" "}
              {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
              {subscription.canceledAt
                ? `, résilié le ${formatDate(subscription.canceledAt)}`
                : ""}
              ).
            </p>
            <p className="text-sm text-muted-foreground">
              Vous n&apos;avez pas d&apos;abonnement actif.
            </p>
          </div>
        ) : null}

        <SubscriptionStatus subscription={subscriptionData} showPeriod />

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Link
            href="/abonnement"
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Changer de plan
          </Link>
          {subscription?.stripeSubscriptionId ? (
            <p className="text-xs text-muted-foreground">
              Référence Stripe : <span className="font-mono">{subscription.stripeSubscriptionId}</span>
            </p>
          ) : null}
        </div>
      </section>

      {subscription ? (
        <section className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Détail de la formule</h2>
          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Formule</dt>
              <dd className="font-medium text-foreground">{subscription.plan.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Prix</dt>
              <dd className="font-medium text-foreground">
                {formatPrice(subscription.plan.price, subscription.plan.currency)}
                {PRICE_SUFFIX[subscription.plan.interval] ?? ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Statut</dt>
              <dd className="font-medium text-foreground">
                {SUBSCRIPTION_STATUS_LABELS[subscription.status] ?? subscription.status}
                {subscription.cancelAtPeriodEnd ? " (résiliation programmée)" : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Souscrit le</dt>
              <dd className="font-medium text-foreground">{formatDate(subscription.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Début de la période</dt>
              <dd className="font-medium text-foreground">
                {formatDate(subscription.currentPeriodStart)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Fin de la période</dt>
              <dd className="font-medium text-foreground">
                {formatDate(subscription.currentPeriodEnd)}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Historique des événements</h2>
        <div className="mt-5">
          <SubscriptionTimeline
            events={events}
            emptyLabel="Aucun événement enregistré pour le moment."
          />
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Historique des paiements</h2>
        <p className="mt-1 text-sm text-muted-foreground">Vos 10 derniers paiements.</p>
        <div className="mt-5">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun paiement pour le moment.</p>
          ) : (
            // Défilement horizontal sur mobile : le tableau reste lisible.
            <div className="scroll-x">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Vos 10 derniers paiements</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Date
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Montant
                    </th>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Statut
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      Facture
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 text-foreground">
                        {formatDate(payment.paidAt ?? payment.createdAt)}
                      </td>
                      <td className="py-3 pr-4 font-semibold tabular-nums text-foreground">
                        {formatPrice(payment.amount, payment.currency)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="status" tone={PAYMENT_TONES[payment.status] ?? "neutral"}>
                          {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                        </Badge>
                      </td>
                      <td className="py-3">
                        {payment.invoiceUrl ? (
                          <a
                            href={payment.invoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-editorial-link underline transition-colors hover:text-editorial-link"
                          >
                            Voir la facture
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
