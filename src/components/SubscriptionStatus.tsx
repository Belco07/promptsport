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
        <p className="text-sm text-gray-700">Vous n&apos;avez pas d&apos;abonnement actif.</p>
        <Link
          href="/abonnement"
          className="inline-block rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
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
          <dt className="text-gray-500">Formule</dt>
          <dd className="font-medium text-gray-900">{subscription.planName}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Prix</dt>
          <dd className="font-medium text-gray-900">{subscription.priceLabel}</dd>
        </div>
        {showPeriod ? (
          <div>
            <dt className="text-gray-500">Début de la période</dt>
            <dd className="font-medium text-gray-900">{subscription.periodStartLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-gray-500">
            {subscription.cancelAtPeriodEnd ? "Fin de l'accès" : "Prochain renouvellement"}
          </dt>
          <dd className="font-medium text-gray-900">{subscription.periodEndLabel}</dd>
        </div>
      </dl>

      {subscription.cancelAtPeriodEnd ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Votre abonnement se termine le {subscription.periodEndLabel}.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={openPortal}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:opacity-60"
        >
          {isPending ? "Ouverture…" : "Gérer mon abonnement"}
        </button>

        {subscription.cancelAtPeriodEnd ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(reactivateSubscription, "Votre abonnement est réactivé.")}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
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
            className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
          >
            Annuler l&apos;abonnement
          </button>
        )}
      </div>

      {notice ? (
        <p role="status" className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
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
