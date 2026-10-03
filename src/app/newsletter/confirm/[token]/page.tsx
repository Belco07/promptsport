import type { Metadata } from "next";
import { CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { Card, CardBody } from "@/components/ui/Card";
import { confirmSubscriberByToken, sendWelcomeEmail } from "@/lib/newsletter-send";

/**
 * Confirmation d'inscription — double opt-in (WP11b).
 *
 * La page effectue la confirmation au chargement : c'est le lien reçu par e-mail
 * qui doit agir, sans formulaire intermédiaire (le brief le demande ainsi). Un
 * jeton inconnu renvoie un vrai 404.
 *
 * L'e-mail de bienvenue est envoyé **au mieux** : un fournisseur indisponible ne
 * doit pas transformer une inscription réussie en page d'erreur.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmation d'inscription",
  description: "Confirmation de votre inscription à la newsletter.",
  robots: { index: false, follow: false },
};

export default async function NewsletterConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const outcome = await confirmSubscriberByToken(token);

  if (outcome.status === "invalid") {
    notFound();
  }

  if (outcome.status === "confirmed") {
    const email = await sendWelcomeEmail({
      id: outcome.subscriber.id,
      email: outcome.subscriber.email,
      name: outcome.subscriber.name,
      confirmationToken: token,
    });
    if (!email.success) {
      console.warn(`[newsletter] e-mail de bienvenue non envoyé : ${email.error}`);
    }
  }

  const title =
    outcome.status === "confirmed"
      ? "Inscription confirmée"
      : outcome.status === "already-confirmed"
        ? "Inscription déjà confirmée"
        : "Adresse invalide";

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-2xl px-4 py-14">
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  outcome.status === "bounced"
                    ? "bg-danger-50 text-danger-700"
                    : "bg-success-50 text-success-700"
                }`}
              >
                {outcome.status === "bounced" ? (
                  <XCircle className="h-5 w-5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
              </span>
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-primary-900">{title}</h1>
                <p className="mt-2 text-sm text-neutral-700">
                  {outcome.status === "confirmed" ? (
                    <>
                      Merci ! L&apos;adresse <strong>{outcome.subscriber.email}</strong> recevra
                      désormais la newsletter. Un e-mail de bienvenue vient de partir.
                    </>
                  ) : outcome.status === "already-confirmed" ? (
                    <>
                      L&apos;adresse <strong>{outcome.subscriber.email}</strong> était déjà
                      confirmée : il n&apos;y a rien de plus à faire.
                    </>
                  ) : (
                    <>
                      L&apos;adresse <strong>{outcome.subscriber.email}</strong> a été rejetée par
                      notre fournisseur d&apos;envoi : elle ne peut pas recevoir la newsletter.
                      Contactez-nous si vous pensez qu&apos;il s&apos;agit d&apos;une erreur.
                    </>
                  )}
                </p>
                <p className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                  <Link
                    href="/"
                    className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                  >
                    Retour à l&apos;accueil
                  </Link>
                  {/* Le jeton sert aussi de lien de gestion : l'abonné règle ses
                      listes ou se désabonne sans attendre un prochain e-mail. */}
                  {outcome.status !== "bounced" ? (
                    <Link
                      href={`/newsletter/preferences/${token}`}
                      className="font-semibold text-neutral-600 underline transition-colors hover:text-neutral-900"
                    >
                      Gérer mes préférences
                    </Link>
                  ) : null}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </main>

      <Footer />
    </>
  );
}
