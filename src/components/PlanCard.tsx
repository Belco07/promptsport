"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { createBillingPortalSession, createCheckoutSession } from "@/app/abonnement/actions";
import { Check } from "@/components/icons";
import { formatPrice } from "@/lib/subscription-utils";

const INTERVAL_SUFFIX: Record<string, string> = {
  MONTH: "/ mois",
  YEAR: "/ an",
  LIFETIME: "une fois",
};

/** Avantages affichés par formule : uniquement ce que le site tient réellement. */
const INTERVAL_FEATURES: Record<string, string[]> = {
  MONTH: [
    "Accès illimité aux articles premium",
    "Sans engagement, résiliable à tout moment",
    "Paiement sécurisé par Stripe",
  ],
  YEAR: [
    "Accès illimité aux articles premium",
    "Renouvellement annuel, résiliable depuis votre compte",
    "Paiement sécurisé par Stripe",
  ],
  LIFETIME: [
    "Accès illimité aux articles premium, pour toujours",
    "Paiement unique, sans renouvellement",
    "Paiement sécurisé par Stripe",
  ],
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
 * Carte d'une formule, façon kiosque (L'Équipe) : nom en capitales, prix en
 * grand, équivalence mensuelle et pastille d'économie pour l'annuel (calculée
 * sur le prix du mensuel), avantages cochés,
 * puis le bouton de souscription. La formule recommandée est liserée de la
 * couleur d'accent et son bouton passe en vert lime.
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
  isRecommended = false,
  monthlyReferencePrice = null,
}: {
  plan: PlanCardData;
  isLoggedIn: boolean;
  isOwnedPlan: boolean;
  hasActiveSubscription: boolean;
  /** Formule mise en avant (liseré et bouton d'accent). */
  isRecommended?: boolean;
  /** Prix de la formule mensuelle, pour chiffrer l'économie de l'annuel. */
  monthlyReferencePrice?: number | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suffix = INTERVAL_SUFFIX[plan.interval] ?? "";
  const features = INTERVAL_FEATURES[plan.interval] ?? [];

  // Annuel : équivalent mensuel et économie réelle par rapport au mensuel.
  let equivalence: string | null = null;
  let savingPercent: number | null = null;
  if (plan.interval === "YEAR") {
    equivalence = `soit ${formatPrice(Math.round(plan.price / 12), plan.currency)} / mois`;
    if (monthlyReferencePrice) {
      const saved = monthlyReferencePrice * 12 - plan.price;
      if (saved > 0) savingPercent = Math.round((saved / (monthlyReferencePrice * 12)) * 100);
    }
  }

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

  const ctaClass = [
    "flex h-12 w-full items-center justify-center rounded-[13px] px-5 text-base font-bold transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60",
    isRecommended ? "bg-accent text-[#111211]" : "bg-foreground text-background",
  ].join(" ");
  const manageClass =
    "flex h-12 w-full items-center justify-center rounded-[13px] border border-border bg-card px-5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-60";

  return (
    <div
      className={[
        "relative flex h-full flex-col rounded-[18px] bg-card p-7 shadow-[0_4px_20px_rgb(0_0_0/7%)]",
        isRecommended ? "border-2 border-accent" : "border border-border",
      ].join(" ")}
    >
      {isRecommended ? (
        <p className="absolute -top-3.5 left-7 rounded-full bg-accent px-3.5 py-1 text-xs font-extrabold uppercase tracking-[1px] text-[#111211]">
          Recommandé
        </p>
      ) : null}

      <h2 className="text-[13px] font-extrabold uppercase tracking-[1px] text-muted-foreground">{plan.name}</h2>

      <p className="mt-4 flex items-baseline gap-2 text-foreground">
        <span className="text-[40px] font-black leading-none tracking-[-1.5px]">{formatPrice(plan.price, plan.currency)}</span>
        <span className="text-sm font-semibold text-muted-foreground">{suffix}</span>
        {savingPercent ? (
          <span className="ml-auto self-center rounded-full bg-accent px-2.5 py-0.5 text-xs font-extrabold text-[#111211]">
            −{savingPercent} %
          </span>
        ) : null}
      </p>
      {/* Ligne réservée sur toutes les cartes, pour aligner les descriptions. */}
      <p className="mt-2 min-h-5 text-sm font-semibold text-editorial-link">{equivalence}</p>

      {plan.description ? <p className="mt-4 text-sm leading-6 text-muted-foreground">{plan.description}</p> : null}

      <ul className="mt-5 flex-1 space-y-2.5 border-t border-border pt-5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-foreground">
            <Check aria-hidden="true" size={18} className="mt-px shrink-0 text-editorial-link" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-7">
        {isOwnedPlan ? (
          <div className="space-y-3">
            <p className="rounded-[13px] border border-status-success-border bg-status-success px-3 py-2 text-sm text-status-success-foreground">
              Vous êtes déjà abonné au plan {plan.name}.
            </p>
            <button type="button" disabled={isPending} onClick={() => go(createBillingPortalSession)} className={manageClass}>
              {isPending ? "Ouverture…" : "Gérer mon abonnement"}
            </button>
          </div>
        ) : hasActiveSubscription ? (
          <div className="space-y-3">
            <p className="rounded-[13px] border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              Un abonnement est déjà actif sur votre compte.
            </p>
            <button type="button" disabled={isPending} onClick={() => go(createBillingPortalSession)} className={manageClass}>
              {isPending ? "Ouverture…" : "Gérer mon abonnement"}
            </button>
          </div>
        ) : isLoggedIn ? (
          <button type="button" disabled={isPending} onClick={() => go(() => createCheckoutSession(plan.id))} className={ctaClass}>
            {isPending ? "Redirection…" : "Je m'abonne"}
          </button>
        ) : (
          <Link href="/login" className={ctaClass}>
            Je m&apos;abonne
          </Link>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-[13px] border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}
