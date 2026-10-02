"use client";

import { useState } from "react";

import { sendTestEmail } from "@/app/backoffice/newsletter/campaigns/actions";

/**
 * Bouton « Envoyer un test » avec saisie d'adresse (WP11d).
 *
 * Le test part à une seule adresse et ne crée aucun `NewsletterSend` : il ne
 * compte ni comme destinataire, ni comme ouverture. La modale est un simple
 * `<form>` qui poste la Server Action liée — le champ e-mail vit dans le
 * formulaire, donc la saisie ne dépend pas de React.
 */
export function TestEmailButton({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-primary-300 hover:bg-primary-50"
      >
        Envoyer un test
      </button>

      {/* Sans JavaScript, la modale ne s'ouvre pas : on rend le formulaire de
          test directement, pour que l'action reste accessible. */}
      <noscript>
        <form action={sendTestEmail.bind(null, campaignId)} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="test-email-noscript" className="mb-1 block text-sm font-semibold text-neutral-800">
              Adresse du test
            </label>
            <input
              id="test-email-noscript"
              name="email"
              type="email"
              required
              placeholder="vous@exemple.fr"
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-primary-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
          >
            Envoyer le test
          </button>
        </form>
      </noscript>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titre-test-envoi"
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-card">
            <h2 id="titre-test-envoi" className="text-lg font-bold text-primary-900">
              Envoyer un test
            </h2>
            <p className="mt-2 text-sm text-neutral-700">
              L&apos;e-mail part à une seule adresse, avec des liens de désabonnement et de suivi
              neutralisés. Aucun abonné n&apos;est touché.
            </p>

            <form action={sendTestEmail.bind(null, campaignId)} className="mt-4 space-y-3">
              <div>
                <label htmlFor="test-email" className="mb-1 block text-sm font-semibold text-neutral-800">
                  Adresse du test
                </label>
                <input
                  id="test-email"
                  name="email"
                  type="email"
                  required
                  placeholder="vous@exemple.fr"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-600"
                />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm font-semibold text-neutral-700 underline"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
                >
                  Envoyer le test
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
