import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSubscriptionMetrics } from "@/lib/subscription";
import { computeArrCents, computeMrrCents, computeTotalPaidCents, countActiveSubscriptions, formatPrice } from "@/lib/subscription-utils";

/**
 * Tableau de bord du backoffice (administration).
 */
export default async function BackofficePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const displayName = session.user.name ?? session.user.email ?? "auteur";
  const [userCount, upcomingMatches, subscriptions, payments, metrics, pendingComments, pendingReports, confirmedSubscribers] = await Promise.all([
    prisma.author.count(),
    prisma.match.count({
      where: { status: "SCHEDULED", scheduledAt: { gte: new Date() } },
    }),
    prisma.subscription.findMany({
      select: { status: true, plan: { select: { price: true, interval: true } } },
    }),
    prisma.payment.findMany({ select: { amount: true, status: true } }),
    getSubscriptionMetrics(),
    // Engagement (WP10a) : commentaires et signalements à traiter.
    prisma.comment.count({ where: { status: "PENDING" } }),
    prisma.report.count({ where: { status: "PENDING" } }),
    // Newsletter (WP11a) : abonnés confirmés, affichés dans le raccourci.
    prisma.newsletterSubscriber.count({ where: { status: "CONFIRMED" } }),
  ]);

  const activeSubscriptions = countActiveSubscriptions(subscriptions);
  const mrrCents = computeMrrCents(subscriptions);
  const arrCents = computeArrCents(subscriptions);
  const totalPaidCents = computeTotalPaidCents(payments);

  return (
    <div className="px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        Bienvenue dans le backoffice, {displayName}
      </h1>

      <p className="mt-2 text-sm text-muted-foreground">
        Espace d&apos;administration.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Abonnements actifs
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">{activeSubscriptions}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Revenu mensuel récurrent (MRR)
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {formatPrice(mrrCents)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Revenu annuel récurrent (ARR)
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {formatPrice(arrCents)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Total encaissé
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {formatPrice(totalPaidCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            abonnements et achats uniques
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Nouveaux abonnés (ce mois)
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">{metrics.newThisMonth}</p>
          <p className="mt-1 text-xs text-muted-foreground">abonnements créés ce mois-ci</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Taux de churn (ce mois)
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {metrics.churnRatePercent.toLocaleString("fr-FR")} %
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {metrics.churnedThisMonth} annulation{metrics.churnedThisMonth > 1 ? "s" : ""} sur la
            période
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/backoffice/users"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Gérer les utilisateurs ({userCount})
        </Link>
        <Link
          href="/backoffice/sports"
          className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Sports ({upcomingMatches} match à venir)
        </Link>
        <Link
          href="/backoffice/comments"
          className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Commentaires ({pendingComments} en attente · {pendingReports} signalement
          {pendingReports > 1 ? "s" : ""})
        </Link>
        <Link
          href="/backoffice/analytics"
          className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Analytics (audience)
        </Link>
        <Link
          href="/backoffice/newsletter"
          className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Newsletter ({confirmedSubscribers} confirmé{confirmedSubscribers > 1 ? "s" : ""})
        </Link>
        <Link
          href="/backoffice/subscriptions"
          className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Abonnements ({activeSubscriptions} actif{activeSubscriptions > 1 ? "s" : ""})
        </Link>
      </div>
    </div>
  );
}
