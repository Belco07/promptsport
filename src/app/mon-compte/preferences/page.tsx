import type { Metadata } from "next";
import { BellRing } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { NotificationPreferences } from "@/components/NotificationPreferences";
import { Footer } from "@/components/Footer";
import { Card, CardBody } from "@/components/ui/Card";
import { auth } from "@/lib/auth";
import {
  EMAIL_NOTIFICATION_LABELS,
  EMAIL_NOTIFICATION_TYPES,
  disabledTypes,
} from "@/lib/notification-email";
import { toggleClubDigest } from "@/app/match/[id]/actions";
import { prisma } from "@/lib/prisma";

/**
 * Préférences de notification (WP11e).
 *
 * Deux niveaux : un interrupteur global et une case par type d'e-mail. La page
 * est protégée par la session — les préférences ne concernent que le compte
 * connecté — et sert aussi de cible au lien de désabonnement présent dans chaque
 * e-mail de notification.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Préférences de notification",
  description: "Choisissez les notifications que vous recevez par e-mail.",
  robots: { index: false, follow: false },
};

export default async function NotificationPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ enregistre?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const [params, author] = await Promise.all([
    searchParams,
    prisma.author.findUnique({
      where: { id: session.user.id },
      select: {
        followedTeams: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        clubDigests: { select: { clubId: true, enabled: true } },
        email: true,
        name: true,
        emailNotificationsEnabled: true,
        emailNotificationTypes: true,
      },
    }),
  ]);

  if (!author) {
    redirect("/login");
  }

  const disabled = disabledTypes(author.emailNotificationTypes);
  const options = EMAIL_NOTIFICATION_TYPES.map((type) => ({
    type,
    label: EMAIL_NOTIFICATION_LABELS[type].label,
    hint: EMAIL_NOTIFICATION_LABELS[type].hint,
  }));

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-4xl px-4 py-10">
        <header className="mb-6 border-b border-border pb-5">
          <p className="inline-flex items-center gap-2 rounded-full border border-editorial-link bg-secondary px-3 py-1 text-xs font-semibold text-editorial-link">
            <BellRing aria-hidden="true" className="h-3.5 w-3.5" />
            Notifications
          </p>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            Préférences de notification
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {author.name} · {author.email}. Vos notifications restent visibles dans{" "}
            <Link
              href="/mon-compte/notifications"
              className="font-semibold text-editorial-link underline transition-colors hover:text-editorial-link"
            >
              votre espace notifications
            </Link>{" "}
            quel que soit votre choix ici.
          </p>
        </header>

        {params.enregistre === "1" ? (
          <p
            role="status"
            className="mb-6 rounded-lg border border-status-success-border bg-status-success px-4 py-3 text-sm font-medium text-status-success-foreground"
          >
            Vos préférences de notification sont enregistrées.
          </p>
        ) : null}

        <Card>
          <CardBody>
            <NotificationPreferences
              options={options}
              enabled={author.emailNotificationsEnabled}
              disabledTypes={disabled}
            />
          </CardBody>
        </Card>

        <section aria-labelledby="club-digests-heading" className="mt-8 rounded-xl border border-border bg-card p-5"><h2 id="club-digests-heading" className="text-xl font-bold text-foreground">Mes digests clubs</h2><p className="mb-4 mt-2 text-sm text-muted-foreground">Choisissez les clubs de votre résumé hebdomadaire. Les envois automatiques ne sont pas encore activés. Désactivation possible à tout moment.</p>{author.followedTeams.length ? <ul className="space-y-3">{author.followedTeams.map(club => { const enabled = author.clubDigests.some(subscription => subscription.clubId === club.id && subscription.enabled); return <li key={club.id} className="flex flex-wrap items-center justify-between gap-3"><span className="font-medium text-foreground">{club.name}</span><form action={async () => { "use server"; await toggleClubDigest(club.id); redirect("/mon-compte/preferences?enregistre=1"); }}><button className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-bold text-foreground" aria-label={`${enabled ? "Désactiver" : "Activer"} le digest de ${club.name}`}>{enabled ? "Désactiver le digest" : "Activer le digest"}</button></form></li>; })}</ul> : <p className="text-sm text-muted-foreground">Suivez un club pour activer son digest depuis cette page.</p>}</section>
        <p className="mt-6 text-xs text-muted-foreground">
          Un e-mail est envoyé pour chaque notification importante (réponse à un commentaire,
          décision de modération, suspension de compte), dans la limite de 20 messages par heure.
          Aucun e-mail de notification ne contient de pixel de suivi.
        </p>
      </main>

      <Footer />
    </>
  );
}
