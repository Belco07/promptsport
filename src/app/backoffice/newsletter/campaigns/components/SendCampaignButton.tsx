"use client";

import { useEffect, useState } from "react";

import { sendCampaignNow } from "@/app/backoffice/newsletter/campaigns/actions";

/**
 * Bouton « Envoyer maintenant » avec confirmation modale (WP11d).
 *
 * L'envoi d'une campagne est irréversible : il part vers tous les abonnés
 * confirmés de la liste. La modale rappelle le nombre de destinataires et
 * exige un clic supplémentaire.
 *
 * `defaultOpen` permet d'ouvrir directement la confirmation depuis la liste des
 * campagnes (« Envoyer » y renvoie sur `?envoyer=1`) : l'action reste
 * accessible depuis le tableau, sans contourner la confirmation.
 */
export function SendCampaignButton({
  campaignId,
  subject,
  recipients,
  defaultOpen = false,
}: {
  campaignId: string;
  subject: string;
  recipients: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800"
      >
        Envoyer maintenant
      </button>

      {/* Sans JavaScript, la modale ne peut pas s'ouvrir : le formulaire de
          confirmation est alors rendu tel quel, au prix d'un clic de plus. */}
      <noscript>
        <form action={sendCampaignNow.bind(null, campaignId)} className="mt-4">
          <p className="text-sm font-medium text-danger-700">
            Cette action est irréversible : « {subject} » partira vers {recipients} destinataire
            {recipients > 1 ? "s" : ""}.
          </p>
          <button
            type="submit"
            className="mt-3 rounded-lg bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger-700"
          >
            Confirmer l&apos;envoi à {recipients} destinataire{recipients > 1 ? "s" : ""}
          </button>
        </form>
      </noscript>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="titre-confirmation-envoi"
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-card">
            <h2 id="titre-confirmation-envoi" className="text-lg font-bold text-primary-900">
              Envoyer cette campagne ?
            </h2>
            <p className="mt-2 text-sm text-neutral-700">
              « {subject} » partira immédiatement vers{" "}
              <strong>
                {recipients} destinataire{recipients > 1 ? "s" : ""}
              </strong>{" "}
              (abonnés confirmés de la liste).
            </p>
            <p className="mt-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700">
              Cette action est irréversible : un e-mail envoyé ne peut pas être rappelé.
            </p>

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm font-semibold text-neutral-700 underline"
              >
                Annuler
              </button>
              <form action={sendCampaignNow.bind(null, campaignId)}>
                <button
                  type="submit"
                  className="rounded-lg bg-danger-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-danger-700"
                >
                  Envoyer à {recipients} destinataire{recipients > 1 ? "s" : ""}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
