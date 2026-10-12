"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cancelSubscription,
  openBillingPortal,
  reactivateSubscription,
} from "@/app/mon-compte/actions";

/**
 * Statut d'abonnement de l'espace abonné (WP7d).
 *
 * Trois situations :
 *  - aucun abonnement actif → invitation à découvrir les offres ;
 *  - abonnement en cours → renouvellement, portail Stripe, annulation (avec
 *    confirmation) ;
 *  - résiliation programmée → date de fin et bouton de réactivation.
 */
export type SubscriptionStatusData = {
  planName: string;
  priceLabel: string;
  periodStartLabel: string;
  periodEndLabel: string;
  cancelAtPeriodEnd: boolean;
};

export function SubscriptionStatus({
  subscription,
  showPeriod = true,
}: {
  subscription: SubscriptionStatusData | null;
  showPeriod?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(
    action: () => Promise<{ ok: true } | { ok: false; error: string }>,
    successNotice: string,
  ) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setNotice(successNotice);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function openPortal() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal();
      if (result.ok) {
        window.location.href = result.url;
      } else {
        setError(result.error);
      }
    });
  }

  if (!subscription) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-foreground">Vous n&apos;avez pas d&apos;abonnement actif.</p>
        <Link
          href="/abonnement"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Voir les offres
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Formule</dt>
          <dd className="font-medium text-foreground">{subscription.planName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Prix</dt>
          <dd className="font-medium text-foreground">{subscription.priceLabel}</dd>
        </div>
        {showPeriod ? (
          <div>
            <dt className="text-muted-foreground">Début de la période</dt>
            <dd className="font-medium text-foreground">{subscription.periodStartLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground">
            {subscription.cancelAtPeriodEnd ? "Fin de l'accès" : "Prochain renouvellement"}
          </dt>
          <dd className="font-medium text-foreground">{subscription.periodEndLabel}</dd>
        </div>
      </dl>

      {subscription.cancelAtPeriodEnd ? (
        <p className="rounded-md border border-status-warning-border bg-status-warning px-3 py-2 text-sm text-status-warning-foreground">
          Votre abonnement se termine le {subscription.periodEndLabel}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={openPortal}
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {isPending ? "Ouverture…" : "Gérer mon abonnement"}
        </button>

        {subscription.cancelAtPeriodEnd ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(reactivateSubscription, "Votre abonnement est réactivé.")}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            Réactiver
          </button>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Confirmez-vous l'annulation ? Vous conserverez l'accès jusqu'à la fin de la période en cours.",
                )
              ) {
                run(cancelSubscription, "Votre abonnement est annulé en fin de période.");
              }
            }}
            className="rounded-md border border-status-error-border bg-card px-4 py-2 text-sm font-medium text-status-error-foreground transition-colors hover:bg-status-error disabled:opacity-60"
          >
            Annuler l&apos;abonnement
          </button>
        )}
      </div>

      {notice ? (
        <p role="status" className="rounded-md border border-status-success-border bg-status-success px-3 py-2 text-sm text-status-success-foreground">
          {notice}
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
