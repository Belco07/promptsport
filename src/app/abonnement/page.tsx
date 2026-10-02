import type { Metadata } from "next";
import { Check, CreditCard, Lock, Sparkles } from "lucide-react";
import Link from "next/link";

import { PlanCard } from "@/components/PlanCard";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPageMetadata } from "@/lib/seo";
import { isStripeConfigured } from "@/lib/stripe";

/**
 * Page des offres d'abonnement (WP7b, refonte visuelle WP9).
 *
 * Volontairement non indexée : c'est une page de conversion, pas de contenu
 * éditorial — elle ne doit pas concurrencer les articles dans les résultats.
 */
export const metadata: Metadata = buildPageMetadata({
  title: "Abonnez-vous",
  description: "Choisissez votre formule et accédez à tous les articles premium du site.",
  path: "/abonnement",
  robots: { index: false, follow: false },
});

export const dynamic = "force-dynamic";

/** Avantages réels de l'abonnement (rien qui ne soit pas tenu par le site). */
const BENEFITS = [
  "Accès illimité à tous les articles premium",
  "Annulation à tout moment, depuis votre compte",
  "Paiement sécurisé par Stripe",
];

/**
 * Formule mise en avant : l'abonnement annuel s'il existe (meilleur rapport
 * qualité-prix), sinon la formule intermédiaire.
 */
function recommendedPlanId(plans: Array<{ id: string; interval: string }>): string | null {
  const yearly = plans.find((plan) => plan.interval === "YEAR");
  if (yearly) return yearly.id;
  if (plans.length === 0) return null;
  return plans[Math.floor((plans.length - 1) / 2)].id;
}

/** Questions fréquentes : réponses vérifiables, sans JavaScript (balise details). */
const FAQ = [
  {
    question: "Puis-je annuler mon abonnement ?",
    answer:
      "Oui, à tout moment depuis votre espace « Mon compte ». L'accès premium reste actif jusqu'à la fin de la période déjà réglée.",
  },
  {
    question: "Comment se passe le renouvellement ?",
    answer:
      "Les formules mensuelle et annuelle sont renouvelées automatiquement à échéance. La formule à vie est un paiement unique, sans renouvellement.",
  },
  {
    question: "Quels moyens de paiement sont acceptés ?",
    answer:
      "Le paiement est traité par Stripe. Aucune donnée bancaire n'est stockée sur ce site : seuls l'identifiant client et le statut de l'abonnement sont conservés.",
  },
];

export default async function SubscriptionPlansPage() {
  const session = await auth();

  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { price: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      interval: true,
    },
  });

  // Tous les plans réellement détenus (un utilisateur peut en cumuler
  // plusieurs) : un seul « findFirst » laisserait, par exemple, un membre à vie
  // pouvoir racheter son plan à vie.
  let ownedPlanIds: string[] = [];
  if (session?.user?.id) {
    const owned = await prisma.subscription.findMany({
      where: { userId: session.user.id, status: { in: ["ACTIVE", "TRIALING"] } },
      select: { planId: true },
    });
    ownedPlanIds = [...new Set(owned.map((subscription) => subscription.planId))];
  }
  const hasActiveSubscription = ownedPlanIds.length > 0;
  const recommended = recommendedPlanId(plans);

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-5xl px-4 py-10">
        <header className="mb-10 text-center">
          <Badge variant="premium" className="mb-4">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            Contenus premium
          </Badge>
          <h1 className="text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
            Abonnez-vous
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-base text-neutral-600">
            Accédez à tous les contenus premium du site et soutenez un journalisme sportif
            indépendant.
          </p>
        </header>

        <ul className="mb-10 grid gap-3 sm:grid-cols-3">
          {BENEFITS.map((benefit) => (
            <li
              key={benefit}
              className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-700 shadow-card"
            >
              <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
              {benefit}
            </li>
          ))}
        </ul>

        {!isStripeConfigured() ? (
          <p
            role="alert"
            className="mb-8 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-accent-800"
          >
            Les paiements ne sont pas encore configurés (clé Stripe absente). La souscription sera
            indisponible jusqu&apos;à l&apos;ajout de{" "}
            <code className="font-mono">STRIPE_SECRET_KEY</code>.
          </p>
        ) : null}

        {plans.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-sm text-neutral-500">
            Aucun plan disponible pour le moment.
          </p>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const isRecommended = plan.id === recommended;
              return (
                <div
                  key={plan.id}
                  className={
                    isRecommended
                      ? "relative rounded-2xl bg-gradient-to-b from-accent-500 to-accent-600 p-[2px] shadow-card-hover lg:-mt-3"
                      : ""
                  }
                >
                  {isRecommended ? (
                    <p className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-accent-700 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                      Recommandé
                    </p>
                  ) : null}
                  <PlanCard
                    plan={plan}
                    isLoggedIn={Boolean(session?.user)}
                    isOwnedPlan={ownedPlanIds.includes(plan.id)}
                    hasActiveSubscription={hasActiveSubscription}
                  />
                </div>
              );
            })}
          </div>
        )}

        <section aria-labelledby="faq" className="mt-14">
          <h2
            id="faq"
            className="mb-5 text-2xl font-extrabold tracking-tight text-primary-900"
          >
            Questions fréquentes
          </h2>
          <div className="space-y-3">
            {FAQ.map((item) => (
              // <details> : repli accessible et sans JavaScript.
              <details key={item.question} className="rounded-xl border border-neutral-200 bg-white">
                <summary className="cursor-pointer rounded-xl px-5 py-4 text-sm font-bold text-neutral-800 marker:text-accent-500">
                  {item.question}
                </summary>
                <p className="px-5 pb-4 text-sm leading-7 text-neutral-600">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <Card className="mt-12">
          <CardBody className="flex flex-col items-center gap-4 text-center">
            <Lock aria-hidden="true" className="h-6 w-6 text-neutral-400" />
            <p className="max-w-xl text-sm text-neutral-600">
              Vous préférez d&apos;abord lire ? Consultez les scores et les derniers articles ;
              l&apos;abonnement n&apos;est nécessaire que pour les contenus marqués « Premium ».
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/scores" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Voir les scores
              </Link>
              <Link href="/mon-compte" className={buttonStyles({ variant: "ghost", size: "sm" })}>
                <CreditCard aria-hidden="true" className="h-4 w-4" />
                Mon compte
              </Link>
            </div>
          </CardBody>
        </Card>
      </main>

      <Footer />
    </>
  );
}
