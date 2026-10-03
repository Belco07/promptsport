import type { Metadata } from "next";
import { Bell, CreditCard, Receipt, ShieldCheck, User } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Footer } from "@/components/Footer";
import { NotificationItem, type NotificationRow } from "@/components/NotificationItem";
import { SubscriptionStatus } from "@/components/SubscriptionStatus";
import { SubscriptionTimeline } from "@/components/SubscriptionTimeline";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";
import {
  getActiveSubscription,
  getSubscriptionEvents,
  getUserPayments,
  withInvoiceUrls,
} from "@/lib/subscription";
import { PAYMENT_STATUS_LABELS, formatPrice } from "@/lib/subscription-utils";

import { updatePassword, updateProfile } from "./actions";

/**
 * Espace abonné (WP7d, refonte visuelle WP9) : profil, abonnement, historique
 * des paiements, sécurité. Page protégée : un visiteur non connecté est
 * redirigé vers /login.
 */

export const metadata: Metadata = {
  title: "Mon compte",
  description: "Votre profil, votre abonnement et vos paiements.",
};

export const dynamic = "force-dynamic";

/** Suffixe de prix selon l'intervalle du plan. */
const PRICE_SUFFIX: Record<string, string> = {
  MONTH: " / mois",
  YEAR: " / an",
  LIFETIME: " (à vie)",
};

/** Teinte du badge de statut de paiement, sur la palette du design system. */
const PAYMENT_TONES: Record<string, BadgeTone> = {
  SUCCEEDED: "success",
  PENDING: "neutral",
  FAILED: "danger",
  REFUNDED: "accent",
};

/** Codes d'erreur renvoyés par les Server Actions. */
const ERROR_MESSAGES: Record<string, string> = {
  "nom-court": "Le nom doit contenir au moins 2 caractères.",
  "nom-long": "Le nom ne peut pas dépasser 80 caractères.",
  "motdepasse-champs": "Tous les champs de mot de passe sont obligatoires.",
  "motdepasse-court": "Le nouveau mot de passe doit contenir au moins 6 caractères.",
  "motdepasse-different": "Les deux saisies du nouveau mot de passe ne correspondent pas.",
  "motdepasse-identique": "Le nouveau mot de passe doit être différent de l'actuel.",
  "motdepasse-actuel": "Le mot de passe actuel est incorrect.",
};

/** Bloc de l'espace abonné : titre, icône, explication et contenu. */
function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card as="section">
      <CardBody>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700"
          >
            {icon}
          </span>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-primary-900">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-neutral-500">{description}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-5">{children}</div>
      </CardBody>
    </Card>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ profil?: string; motdepasse?: string; erreur?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;

  const [author, subscription, rawPayments, latestNotifications, unreadCount] = await Promise.all([
    prisma.author.findUnique({
      where: { id: session.user.id },
      select: { name: true, email: true, createdAt: true },
    }),
    getActiveSubscription(session.user.id),
    getUserPayments(session.user.id, 10),
    // WP10d : aperçu des 5 dernières notifications non lues.
    prisma.notification.findMany({
      where: { userId: session.user.id, read: false },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        linkUrl: true,
        read: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { userId: session.user.id, read: false } }),
  ]);

  if (!author) {
    redirect("/login");
  }

  // Complète les liens de facture manquants (paiements antérieurs au WP7d).
  const payments = await withInvoiceUrls(rawPayments);
  // Journal réel des événements d'abonnement (WP7e).
  const events = subscription ? await getSubscriptionEvents(subscription.id, 3) : [];

  const successMessage =
    params.profil === "maj"
      ? "Votre nom a bien été mis à jour."
      : params.motdepasse === "maj"
        ? "Votre mot de passe a bien été modifié."
        : null;
  const errorMessage = params.erreur
    ? (ERROR_MESSAGES[params.erreur] ?? "Une erreur est survenue.")
    : null;

  const subscriptionData = subscription
    ? {
        planName: subscription.plan.name,
        priceLabel: `${formatPrice(subscription.plan.price, subscription.plan.currency)}${
          PRICE_SUFFIX[subscription.plan.interval] ?? ""
        }`,
        periodStartLabel: formatDate(subscription.currentPeriodStart),
        periodEndLabel: formatDate(subscription.currentPeriodEnd),
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      }
    : null;

  const initial = author.name.trim().charAt(0).toUpperCase();
  // Instant de référence partagé par les dates relatives des notifications.
  const now = new Date();

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-10">
        <header className="mb-8 flex items-center gap-4 border-b border-neutral-200 pb-6">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-900 text-xl font-extrabold text-white"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-primary-900 sm:text-3xl">
              Mon compte
            </h1>
            <p className="truncate text-sm text-neutral-500">
              {author.name} · {author.email}
            </p>
            <p className="text-xs text-neutral-500">
              Membre depuis le {formatDate(author.createdAt)}
            </p>
          </div>
        </header>

        {successMessage ? (
          <p
            role="status"
            className="mb-6 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm font-medium text-success-800"
          >
            {successMessage}
          </p>
        ) : null}
        {errorMessage ? (
          <p
            role="alert"
            className="mb-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
          >
            {errorMessage}
          </p>
        ) : null}

        <div className="space-y-6">
          {/* ---------------------------------------------------------- Profil */}
          <Section
            title="Profil"
            description="Votre identité publique sur le site."
            icon={<User className="h-5 w-5" />}
          >
            <form action={updateProfile} className="space-y-4">
              <Input
                id="name"
                name="name"
                type="text"
                label="Nom affiché"
                required
                defaultValue={author.name ?? ""}
                hint="Ce nom signe vos articles et apparaît dans la navigation."
              />

              <Input
                id="email"
                type="email"
                label="Adresse e-mail"
                value={author.email}
                readOnly
                disabled
                hint="La modification de l'e-mail arrivera plus tard : elle nécessite une vérification par e-mail."
              />

              <div className="text-sm">
                <p className="font-medium text-neutral-800">Date d&apos;inscription</p>
                <p className="text-neutral-600">{formatDate(author.createdAt)}</p>
              </div>

              <Button type="submit">Enregistrer</Button>
            </form>
          </Section>

          {/* ------------------------------------------------------ Abonnement */}
          <Section
            title="Abonnement"
            description="Votre formule, son renouvellement et sa gestion."
            icon={<CreditCard className="h-5 w-5" />}
          >
            <SubscriptionStatus subscription={subscriptionData} showPeriod={false} />

            {subscription && events.length > 0 ? (
              <div className="mt-6 border-t border-neutral-100 pt-5">
                <h3 className="text-sm font-bold text-neutral-800">Derniers événements</h3>
                <div className="mt-3">
                  <SubscriptionTimeline events={events} />
                </div>
              </div>
            ) : null}

            {subscription ? (
              <p className="mt-5 text-sm">
                <Link
                  href="/mon-compte/abonnement"
                  className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                >
                  Voir le détail de mon abonnement
                </Link>
              </p>
            ) : null}
          </Section>

          {/* ---------------------------------------------------- Notifications */}
          <Section
            title="Notifications"
            description="Vos dernières alertes non lues (réponses, réactions, modération)."
            icon={<Bell className="h-5 w-5" />}
          >
            {latestNotifications.length === 0 ? (
              <p className="text-sm text-neutral-600">Aucune notification.</p>
            ) : (
              <ul className="space-y-3">
                {latestNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification as NotificationRow}
                    now={now}
                  />
                ))}
              </ul>
            )}

            <p className="mt-5 text-sm">
              <Link
                href="/mon-compte/notifications"
                className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
              >
                Voir toutes les notifications
                {unreadCount > 0 ? ` (${unreadCount} non lue${unreadCount > 1 ? "s" : ""})` : ""}
              </Link>
              {" · "}
              {/* Préférences e-mail (WP11e). */}
              <Link
                href="/mon-compte/preferences"
                className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
              >
                Préférences de notification
              </Link>
            </p>
          </Section>

          {/* ------------------------------------------- Historique des paiements */}
          <Section
            title="Historique des paiements"
            description="Vos 10 derniers paiements."
            icon={<Receipt className="h-5 w-5" />}
          >
            {payments.length === 0 ? (
              <p className="text-sm text-neutral-600">Aucun paiement pour le moment.</p>
            ) : (
              // Défilement horizontal sur mobile : le tableau reste lisible.
              <div className="scroll-x">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Vos 10 derniers paiements</caption>
                  <thead>
                    <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Date
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Montant
                      </th>
                      <th scope="col" className="py-2 pr-4 font-semibold">
                        Statut
                      </th>
                      <th scope="col" className="py-2 font-semibold">
                        Facture
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-neutral-100 last:border-0">
                        <td className="py-3 pr-4 text-neutral-900">
                          {formatDate(payment.paidAt ?? payment.createdAt)}
                        </td>
                        <td className="py-3 pr-4 font-semibold tabular-nums text-neutral-900">
                          {formatPrice(payment.amount, payment.currency)}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge
                            variant="status"
                            tone={PAYMENT_TONES[payment.status] ?? "neutral"}
                          >
                            {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                          </Badge>
                        </td>
                        <td className="py-3">
                          {payment.invoiceUrl ? (
                            <a
                              href={payment.invoiceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                            >
                              Voir la facture
                            </a>
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* -------------------------------------------------------- Sécurité */}
          <Section
            title="Sécurité"
            description="Changez votre mot de passe (6 caractères minimum)."
            icon={<ShieldCheck className="h-5 w-5" />}
          >
            <form action={updatePassword} className="space-y-4">
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                label="Mot de passe actuel"
                required
                autoComplete="current-password"
              />

              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                label="Nouveau mot de passe"
                required
                minLength={6}
                autoComplete="new-password"
              />

              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                label="Confirmation du nouveau mot de passe"
                required
                minLength={6}
                autoComplete="new-password"
              />

              <Button type="submit">Modifier le mot de passe</Button>
            </form>
          </Section>
        </div>
      </main>

      <Footer />
    </>
  );
}
