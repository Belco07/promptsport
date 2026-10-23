"use client";

import { useState } from "react";

import { PlanCard, type PlanCardData } from "@/components/PlanCard";

type Period = "MONTH" | "YEAR";

/**
 * Formule mise en avant parmi les cartes affichées : l'annuel s'il est visible
 * (meilleur rapport qualité-prix), sinon la formule récurrente intermédiaire,
 * sinon la formule intermédiaire.
 */
function recommendedPlanId(plans: PlanCardData[]): string | null {
  const yearly = plans.find((plan) => plan.interval === "YEAR");
  if (yearly) return yearly.id;
  const recurring = plans.filter((plan) => plan.interval !== "LIFETIME");
  const pool = recurring.length > 0 ? recurring : plans;
  return pool[Math.floor((pool.length - 1) / 2)]?.id ?? null;
}

/** Grille selon le nombre de cartes : classes statiques pour Tailwind. */
const GRID_CLASS: Record<number, string> = {
  1: "max-w-md",
  2: "max-w-3xl md:grid-cols-2",
};

/**
 * Sélecteur mensuel / annuel et cartes des formules (page /abonnement).
 *
 * Comme sur les pages d'abonnement des grands médias (L'Équipe) : le
 * sélecteur, posé sur le bandeau sombre, choisit la période de facturation ;
 * seules les formules de cette période s'affichent, la formule à vie restant
 * toujours visible à côté. Ouvert sur l'annuel, la formule recommandée (sur
 * le mensuel pour un abonné mensuel).
 *
 * Sans formule mensuelle ou sans formule annuelle, le sélecteur n'a pas de
 * sens : il est masqué et toutes les formules s'affichent.
 */
export function PlanSelector({
  plans,
  isLoggedIn,
  ownedPlanIds,
  hasActiveSubscription,
}: {
  plans: PlanCardData[];
  isLoggedIn: boolean;
  ownedPlanIds: string[];
  hasActiveSubscription: boolean;
}) {
  const monthlyReferencePrice = plans.find((plan) => plan.interval === "MONTH")?.price ?? null;
  const yearlyPrice = plans.find((plan) => plan.interval === "YEAR")?.price ?? null;
  const hasToggle = monthlyReferencePrice !== null && yearlyPrice !== null;
  // Un abonné mensuel retrouve d'emblée sa formule ; sinon, ouverture sur l'annuel.
  const ownsMonthly = plans.some((plan) => plan.interval === "MONTH" && ownedPlanIds.includes(plan.id));
  const [period, setPeriod] = useState<Period>(ownsMonthly ? "MONTH" : "YEAR");

  // Économie de l'annuel, affichée dans le sélecteur (même calcul que la carte).
  const savingPercent =
    hasToggle && monthlyReferencePrice * 12 > yearlyPrice
      ? Math.round(((monthlyReferencePrice * 12 - yearlyPrice) / (monthlyReferencePrice * 12)) * 100)
      : null;

  const visible = hasToggle
    ? plans.filter((plan) => plan.interval === "LIFETIME" || plan.interval === period)
    : plans;
  const recommended = recommendedPlanId(visible);

  const optionClass = (active: boolean) =>
    [
      "inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold transition-colors",
      active ? "bg-white text-[#121212]" : "text-white/80 hover:text-white",
    ].join(" ");

  return (
    <>
      {hasToggle ? (
        <div className="mb-7 flex justify-center">
          <div
            role="radiogroup"
            aria-label="Période de facturation"
            className="inline-flex rounded-full bg-white/10 p-1 ring-1 ring-white/15"
          >
            <button
              type="button"
              role="radio"
              aria-checked={period === "MONTH"}
              onClick={() => setPeriod("MONTH")}
              className={optionClass(period === "MONTH")}
            >
              Mensuel
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={period === "YEAR"}
              onClick={() => setPeriod("YEAR")}
              className={optionClass(period === "YEAR")}
            >
              Annuel
              {savingPercent ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-extrabold text-[#111211]">
                  −{savingPercent} %
                </span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`mx-auto grid grid-cols-1 items-stretch gap-6 ${
          GRID_CLASS[visible.length] ?? "max-w-5xl md:grid-cols-3"
        }`}
      >
        {visible.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isLoggedIn={isLoggedIn}
            isOwnedPlan={ownedPlanIds.includes(plan.id)}
            hasActiveSubscription={hasActiveSubscription}
            isRecommended={plan.id === recommended}
            monthlyReferencePrice={monthlyReferencePrice}
          />
        ))}
      </div>
    </>
  );
}
