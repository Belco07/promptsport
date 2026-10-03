import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { updatePreferences } from "@/app/newsletter/actions";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { availableLists, getSubscriberByToken } from "@/lib/newsletter-send";

/**
 * Préférences d'un abonné (WP11c).
 *
 * Permet de changer de listes sans se désabonner, et de revenir après un
 * désabonnement : enregistrer une sélection alors qu'on était `UNSUBSCRIBED`
 * remet le statut à `CONFIRMED` (côté `updateSubscriberPreferences`).
 *
 * Le formulaire est un simple POST de Server Action liée : aucune interaction
 * JavaScript n'est nécessaire, et la page se recharge avec le compte rendu
 * (`?enregistre=ok|vide|invalide|inconnu`) — motif POST/Redirect/GET.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mes préférences newsletter",
  description: "Choisissez les listes de diffusion que vous souhaitez recevoir.",
  robots: { index: false, follow: false },
};

const NOTICES: Record<string, { tone: "success" | "danger"; text: string }> = {
  ok: { tone: "success", text: "Vos préférences sont enregistrées." },
  vide: {
    tone: "danger",
    text: "Choisissez au moins une liste. Pour ne plus rien recevoir, utilisez le désabonnement.",
  },
  invalide: {
    tone: "danger",
    text: "Cette adresse a été rejetée par notre service d'envoi : elle ne peut pas être réactivée.",
  },
  inconnu: { tone: "danger", text: "Nous n'avons pas pu enregistrer vos préférences." },
};

export default async function NewsletterPreferencesPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ enregistre?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const [subscriber, lists] = await Promise.all([getSubscriberByToken(token), availableLists()]);

  if (!subscriber) {
    notFound();
  }

  const notice = query.enregistre ? NOTICES[query.enregistre] : undefined;
  const isUnsubscribed = subscriber.status === "UNSUBSCRIBED";
  const isBounced = subscriber.status === "BOUNCED";

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-2xl px-4 py-12">
        <header className="mb-6 border-b border-neutral-200 pb-5">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-800">
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            Newsletter
          </p>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-primary-900 sm:text-3xl">
            Mes préférences
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            <strong>{subscriber.email}</strong> ·{" "}
            {isBounced ? (
              <Badge variant="status" tone="danger">
                Adresse invalide
              </Badge>
            ) : isUnsubscribed ? (
              <Badge variant="status" tone="neutral">
                Désabonné
              </Badge>
            ) : subscriber.status === "CONFIRMED" ? (
              <Badge variant="status" tone="success">
                Abonné
              </Badge>
            ) : (
              <Badge variant="status" tone="accent">
                Confirmation en attente
              </Badge>
            )}
          </p>
        </header>

        {notice ? (
          <p
            role={notice.tone === "success" ? "status" : "alert"}
            className={`mb-5 rounded-lg border px-4 py-3 text-sm font-medium ${
              notice.tone === "success"
                ? "border-success-200 bg-success-50 text-success-800"
                : "border-danger-200 bg-danger-50 text-danger-700"
            }`}
          >
            {notice.text}
          </p>
        ) : null}

        <Card>
          <CardBody>
            {isBounced ? (
              <p className="text-sm text-neutral-700">
                Cette adresse a été rejetée par notre service d&apos;envoi : elle ne peut plus
                recevoir la newsletter. Écrivez-nous si vous pensez qu&apos;il s&apos;agit d&apos;une
                erreur.
              </p>
            ) : (
              <form action={updatePreferences.bind(null, token)} className="space-y-5">
                {isUnsubscribed ? (
                  <p className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-sm font-medium text-accent-800">
                    Vous êtes actuellement désabonné. Cocher une liste ci-dessous vous réabonne :
                    votre adresse repassera en « abonné » dès l&apos;enregistrement.
                  </p>
                ) : null}

                <fieldset>
                  <legend className="text-sm font-semibold text-neutral-800">
                    Listes de diffusion
                  </legend>
                  {lists.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                      Aucune liste n&apos;est ouverte pour le moment.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {lists.map((list) => (
                        <li key={list.id} className="flex items-start gap-2.5">
                          <input
                            id={`pref-${list.id}`}
                            name="listes"
                            type="checkbox"
                            value={list.id}
                            defaultChecked={subscriber.listIds.includes(list.id)}
                            className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                          />
                          <label htmlFor={`pref-${list.id}`} className="text-sm text-neutral-800">
                            <span className="font-medium">{list.name}</span>
                            {list.description ? (
                              <span className="block text-xs text-neutral-500">
                                {list.description}
                              </span>
                            ) : null}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>

                <div className="flex flex-wrap items-center gap-4">
                  <Button type="submit">Enregistrer mes préférences</Button>
                  <Link
                    href={`/newsletter/unsubscribe/${token}`}
                    className="text-sm font-semibold text-danger-700 underline transition-colors hover:text-danger-800"
                  >
                    Se désabonner de toutes les listes
                  </Link>
                </div>
              </form>
            )}
          </CardBody>
        </Card>

        <p className="mt-6 text-sm">
          <Link
            href="/newsletter"
            className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
          >
            Inscrire une autre adresse
          </Link>
        </p>
      </main>

      <Footer />
    </>
  );
}
