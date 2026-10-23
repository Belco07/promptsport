import type { Metadata } from "next";
import { MailX, TriangleAlert } from "@/components/icons";
import Link from "next/link";
import { notFound } from "next/navigation";

import { confirmUnsubscribe } from "@/app/newsletter/actions";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { getSubscriberByToken } from "@/lib/newsletter-send";

/**
 * Désabonnement sécurisé (WP11c — refonte de la page du WP11b).
 *
 * Changement majeur : **un GET ne modifie plus rien**. La page se contente de
 * lire le statut de l'abonné et affiche une demande de confirmation ; c'est le
 * bouton — une Server Action en POST — qui désabonne.
 *
 * La raison est concrète : les antivirus, aperçus de messagerie et robots
 * d'indexation suivent les liens contenus dans les e-mails. Avec un GET agissant,
 * un abonné pouvait être désabonné sans avoir rien demandé.
 *
 * Après le POST, la Server Action redirige ici avec `?confirme=1`
 * (POST/Redirect/GET) : l'abonné peut recharger la page de succès sans rejouer
 * l'action.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Désabonnement",
  description: "Gérer votre abonnement à la newsletter.",
  robots: { index: false, follow: false },
};

export default async function NewsletterUnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ confirme?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  // Lecture seule : aucune écriture tant que le bouton n'a pas été actionné.
  const subscriber = await getSubscriberByToken(token);

  if (!subscriber) {
    notFound();
  }

  const justConfirmed = query.confirme === "1";
  const alreadyUnsubscribed = subscriber.status === "UNSUBSCRIBED";

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-2xl px-4 py-14">
        <Card>
          <CardBody>
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  justConfirmed || alreadyUnsubscribed
                    ? "bg-muted text-foreground"
                    : "bg-status-warning text-status-warning-foreground"
                }`}
              >
                {justConfirmed || alreadyUnsubscribed ? (
                  <MailX className="h-5 w-5" />
                ) : (
                  <TriangleAlert className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
                  {justConfirmed
                    ? "Vous êtes désabonné."
                    : alreadyUnsubscribed
                      ? "Vous êtes déjà désabonné"
                      : "Voulez-vous vraiment vous désabonner ?"}
                </h1>

                {justConfirmed ? (
                  <p className="mt-2 text-sm text-foreground">
                    L&apos;adresse <strong>{subscriber.email}</strong> ne recevra plus la newsletter.
                    Aucune autre démarche n&apos;est nécessaire.
                  </p>
                ) : alreadyUnsubscribed ? (
                  <p className="mt-2 text-sm text-foreground">
                    L&apos;adresse <strong>{subscriber.email}</strong> est déjà désabonnée : il n&apos;y
                    a rien de plus à faire.
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-foreground">
                    L&apos;adresse <strong>{subscriber.email}</strong> ne recevra plus aucun e-mail de
                    notre part. Si vous souhaitez seulement changer de listes, préférez la gestion de
                    vos préférences.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {!alreadyUnsubscribed ? (
                    // Server Action liée : le bouton poste, la page ne change rien.
                    <form action={confirmUnsubscribe.bind(null, token)}>
                      <Button type="submit" variant="danger">
                        Confirmer le désabonnement
                      </Button>
                    </form>
                  ) : null}

                  <Link
                    href={`/newsletter/preferences/${token}`}
                    className="text-sm font-semibold text-editorial-link underline transition-colors hover:text-editorial-link"
                  >
                    Gérer mes préférences
                  </Link>

                  <Link
                    href="/"
                    className="text-sm font-semibold text-muted-foreground underline transition-colors hover:text-foreground"
                  >
                    Retour à l&apos;accueil
                  </Link>
                </div>

                {!alreadyUnsubscribed ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Ce lien reste valable : vous pouvez revenir plus tard si vous changez d&apos;avis.
                  </p>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>
      </main>

      <Footer />
    </>
  );
}
