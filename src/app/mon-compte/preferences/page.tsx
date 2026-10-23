import PushPreferences from "@/components/PushPreferences";
import type { Metadata } from "next";
import { BellRing } from "@/components/icons";
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
import { setClubDigest } from "@/app/club/[slug]/actions";
import { prisma } from "@/lib/prisma";
import { updateClubAlerts } from "./actions";

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
        alertsEnabled: true,
        favoriteClubId: true,
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
          <p className="inline-flex items-center gap-2 rounded-full border border-accent bg-secondary px-3 py-1 text-xs font-semibold text-editorial-link">
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

        <PushPreferences />
        <section aria-labelledby="club-alerts-heading" className="mt-8 rounded-xl border border-border bg-card p-5"><h2 id="club-alerts-heading" className="text-xl font-bold text-foreground">Alertes de mes clubs</h2><form action={updateClubAlerts} className="mt-4 space-y-4"><label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-foreground"><input type="checkbox" name="alertsEnabled" defaultChecked={author.alertsEnabled} className="h-4 w-4 shrink-0 accent-current"/><span>Recevoir des alertes pour mes clubs suivis</span></label><p className="text-sm text-muted-foreground">Les nouveaux articles apparaissent dans vos notifications. Un récapitulatif des articles et nouveaux matchs est envoyé au maximum une fois par période de 24 heures, si vos notifications par email sont activées. Vous pouvez désactiver ces alertes à tout moment.</p><button className="min-h-11 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-bold text-foreground">Enregistrer mes alertes</button></form></section>
        <section aria-labelledby="club-digests-heading" className="mt-8 rounded-xl border border-border bg-card p-5"><h2 id="club-digests-heading" className="text-xl font-bold text-foreground">Mes digests clubs</h2><p className="mb-4 mt-2 text-sm text-muted-foreground">Choisissez les clubs de votre résumé hebdomadaire. Envoi le dimanche à partir de 20 h (heure du Nigeria). Désactivation possible à tout moment.</p>{author.followedTeams.length ? <div className="space-y-4">{author.followedTeams.map(club => { const enabled = author.clubDigests.some(subscription => subscription.clubId === club.id && subscription.enabled); return <form key={club.id} action={async (formData: FormData) => { "use server"; await setClubDigest(club.id, formData.get("enabled") === "on"); redirect("/mon-compte/preferences?enregistre=1"); }} className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-0"><label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-foreground"><input type="checkbox" name="enabled" defaultChecked={enabled} className="h-4 w-4 shrink-0 accent-current"/><span>Recevoir le résumé hebdomadaire de {club.name}{club.id === author.favoriteClubId ? " (mon club préféré)" : ""}</span></label><button className="min-h-11 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-bold text-foreground" aria-label={`Enregistrer le digest de ${club.name}`}>Enregistrer</button></form>; })}</div> : <p className="text-sm text-muted-foreground">Suivez un club pour activer son digest depuis cette page.</p>}</section>
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
