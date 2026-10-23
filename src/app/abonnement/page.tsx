import type { Metadata } from "next";
import { Check, CreditCard, Lock, Repeat, ShieldCheck, Sparkles } from "@/components/icons";
import Link from "next/link";

import { PageBand } from "@/components/PageBand";
import { PlanSelector } from "@/components/PlanSelector";
import { Footer } from "@/components/Footer";
import { buttonStyles } from "@/components/ui/Button";
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
  "Accès illimité aux articles premium",
  "Annulation à tout moment",
  "Paiement sécurisé",
];

/** Bandeau de réassurance sous les formules. */
const REASSURANCE = [
  {
    icon: ShieldCheck,
    title: "Paiement sécurisé",
    text: "Le paiement est traité par Stripe ; aucune donnée bancaire n'est stockée sur le site.",
  },
  {
    icon: Repeat,
    title: "Résiliation en un clic",
    text: "Depuis « Mon compte », à tout moment. L'accès reste actif jusqu'à la fin de la période réglée.",
  },
  {
    icon: Sparkles,
    title: "Tout le premium",
    text: "Analyses, dossiers et articles marqués « Premium », sur ordinateur comme sur mobile.",
  },
];

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

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-[1280px] px-4 pb-8">
        <PageBand title="Abonnement" />

        {!isStripeConfigured() ? (
          <p
            role="alert"
            className="mb-6 rounded-[13px] border border-status-warning-border bg-status-warning px-4 py-3 text-sm text-status-warning-foreground"
          >
            Les paiements ne sont pas encore configurés (clé Stripe absente). La souscription sera
            indisponible jusqu&apos;à l&apos;ajout de{" "}
            <code className="font-mono">STRIPE_SECRET_KEY</code>.
          </p>
        ) : null}

        {/* Bandeau d'accroche façon kiosque (L'Équipe) : bloc encre arrondi,
            pastille d'accent, titre en grand et engagements. Les cartes des
            formules viennent le chevaucher ; le sélecteur mensuel / annuel
            (PlanSelector) est posé sur sa partie basse. */}
        <header className="relative overflow-hidden rounded-[18px] border border-transparent bg-[#121212] px-6 pb-[136px] pt-12 dark:border-white/15 text-center text-white sm:px-10">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1 text-xs font-extrabold uppercase tracking-[1px] text-[#111211]">
            <Sparkles aria-hidden="true" size={14} />
            PromptSport Premium
          </p>
          <h2 className="mx-auto mt-5 max-w-3xl text-4xl font-black leading-[1.05] tracking-[-1.5px] text-white sm:text-5xl">
            Abonnez-vous à PromptSport
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/75 sm:text-lg">
            Accédez à tous les contenus premium du site et soutenez un journalisme sportif
            indépendant.
          </p>
          <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-semibold">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="inline-flex items-center gap-1.5">
                <Check aria-hidden="true" size={16} className="text-accent" />
                {benefit}
              </li>
            ))}
          </ul>
        </header>

        <div className="relative -mt-[120px] sm:px-6">
          {plans.length === 0 ? (
            <p className="mx-auto max-w-5xl rounded-[18px] border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
              Aucun plan disponible pour le moment.
            </p>
          ) : (
            <PlanSelector
              plans={plans}
              isLoggedIn={Boolean(session?.user)}
              ownedPlanIds={ownedPlanIds}
              hasActiveSubscription={hasActiveSubscription}
            />
          )}
        </div>

        {/* Réassurance : trois engagements, avec icône. */}
        <ul className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-3">
          {REASSURANCE.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3 rounded-[13px] border border-border bg-card p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-[#111211]">
                <Icon aria-hidden="true" size={20} />
              </span>
              <span>
                <span className="block text-sm font-extrabold text-foreground">{title}</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ul>

        <section aria-labelledby="faq" className="mx-auto mt-14 max-w-5xl">
          <h2 id="faq" className="section-title mb-5">
            Questions fréquentes
          </h2>
          <div className="space-y-3">
            {FAQ.map((item) => (
              // <details> : repli accessible et sans JavaScript.
              <details key={item.question} className="rounded-[13px] border border-border bg-card">
                <summary className="cursor-pointer rounded-[13px] px-5 py-4 text-[15px] font-bold text-foreground marker:text-editorial-link">
                  {item.question}
                </summary>
                <p className="px-5 pb-4 text-sm leading-7 text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <div className="mx-auto mt-12 flex max-w-5xl flex-col items-center gap-4 rounded-[18px] border border-border bg-card p-8 text-center">
          <Lock aria-hidden="true" className="h-6 w-6 text-muted-foreground" />
          <p className="max-w-xl text-sm text-muted-foreground">
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
        </div>
      </main>

      <Footer />
    </>
  );
}
