"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { createBillingPortalSession, createCheckoutSession } from "@/app/abonnement/actions";
import { formatPrice } from "@/lib/subscription-utils";

const INTERVAL_SUFFIX: Record<string, string> = {
  MONTH: " / mois",
  YEAR: " / an",
  LIFETIME: "",
};

export type PlanCardData = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  interval: string;
};

/**
 * Carte d'un plan tarifaire, avec le bouton de souscription.
 *
 * - Utilisateur non connecté : le bouton renvoie vers /login.
 * - Plan déjà détenu : affiche le plan courant et le portail de gestion.
 * - Un autre abonnement est actif : nouvel achat bloqué (aucun second débit
 *   possible), les changements de formule passent par le portail Stripe.
 * - Sinon : lance une session Stripe Checkout puis redirige.
 */
export function PlanCard({
  plan,
  isLoggedIn,
  isOwnedPlan,
  hasActiveSubscription,
}: {
  plan: PlanCardData;
  isLoggedIn: boolean;
  isOwnedPlan: boolean;
  hasActiveSubscription: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suffix = INTERVAL_SUFFIX[plan.interval] ?? "";
  const priceLabel = `${formatPrice(plan.price, plan.currency)}${suffix}${
    plan.interval === "LIFETIME" ? " (à vie)" : ""
  }`;

  function go(action: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        window.location.href = result.url;
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{plan.name}</h2>
      {plan.description ? (
        <p className="mt-2 flex-1 text-sm leading-6 text-gray-600">{plan.description}</p>
      ) : (
        <div className="flex-1" />
      )}

      <p className="mt-4 text-2xl font-bold text-gray-900">{priceLabel}</p>

      <div className="mt-5">
        {isOwnedPlan ? (
          <div className="space-y-3">
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              Vous êtes déjà abonné au plan {plan.name}.
            </p>
            <button
              type="button"
              disabled={isPending}
              onClick={() => go(createBillingPortalSession)}
              className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:opacity-60"
            >
              {isPending ? "Ouverture…" : "Gérer mon abonnement"}
            </button>
          </div>
        ) : hasActiveSubscription ? (
          <div className="space-y-3">
            <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              Un abonnement est déjà actif sur votre compte.
            </p>
            <button
              type="button"
              disabled={isPending}
              onClick={() => go(createBillingPortalSession)}
              className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:opacity-60"
            >
              {isPending ? "Ouverture…" : "Gérer mon abonnement"}
            </button>
          </div>
        ) : isLoggedIn ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => go(() => createCheckoutSession(plan.id))}
            className="w-full rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? "Redirection…" : "S'abonner"}
          </button>
        ) : (
          <Link
            href="/login"
            className="block w-full rounded-md bg-blue-700 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-blue-800"
          >
            S&apos;abonner
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
