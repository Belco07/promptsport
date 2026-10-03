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
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-10">
        <header className="mb-6 border-b border-neutral-200 pb-5">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800">
            <BellRing aria-hidden="true" className="h-3.5 w-3.5" />
            Notifications
          </p>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-primary-900 sm:text-3xl">
            Préférences de notification
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            {author.name} · {author.email}. Vos notifications restent visibles dans{" "}
            <Link
              href="/mon-compte/notifications"
              className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
            >
              votre espace notifications
            </Link>{" "}
            quel que soit votre choix ici.
          </p>
        </header>

        {params.enregistre === "1" ? (
          <p
            role="status"
            className="mb-6 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm font-medium text-success-800"
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

        <p className="mt-6 text-xs text-neutral-500">
          Un e-mail est envoyé pour chaque notification importante (réponse à un commentaire,
          décision de modération, suspension de compte), dans la limite de 20 messages par heure.
          Aucun e-mail de notification ne contient de pixel de suivi.
        </p>
      </main>

      <Footer />
    </>
  );
}
