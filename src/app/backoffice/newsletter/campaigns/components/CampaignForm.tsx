"use client";

import Link from "next/link";
import { useActionState } from "react";

/**
 * Formulaire de campagne (WP11d), partagé par la création et l'édition.
 *
 * Composant client par nécessité : `useActionState` affiche les erreurs de
 * validation (sujet vide, liste inactive, contenu manquant) sans perdre la
 * saisie, et l'état d'attente pendant l'enregistrement.
 *
 * L'éditeur de contenu est un simple `textarea` HTML (option A du brief) : un
 * WYSIWYG complet (TipTap, Lexical) serait trop lourd pour ce lot. Le champ
 * accepte le HTML brut, et la prévisualisation montre le rendu réel.
 */

export type CampaignFormValues = {
  subject: string;
  previewText: string;
  listId: string;
  contentHtml: string;
  scheduledAt: string;
};

export type CampaignListOption = {
  id: string;
  name: string;
  active: boolean;
};

const inputClass =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none focus:border-primary-600 focus:ring-1 focus:ring-primary-600";
const labelClass = "mb-1 block text-sm font-semibold text-neutral-800";

const PLACEHOLDER_HTML = `<h1>Bonjour,</h1>
<p>Voici l'essentiel de la semaine :</p>
<ul>
  <li>Le résultat du choc au sommet</li>
  <li>L'analyse de la journée</li>
</ul>
<p><a href="https://exemple.fr/scores">Voir tous les scores</a></p>`;

export function CampaignForm({
  action,
  lists,
  defaultValues,
  submitLabel,
  campaignId,
}: {
  action: (
    previousState: string | undefined,
    formData: FormData,
  ) => Promise<string | undefined>;
  lists: CampaignListOption[];
  defaultValues?: Partial<CampaignFormValues>;
  submitLabel: string;
  /** Renseigné en édition : permet de revenir à la campagne. */
  campaignId?: string;
}) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial: CampaignFormValues = {
    subject: "",
    previewText: "",
    listId: lists[0]?.id ?? "",
    contentHtml: "",
    scheduledAt: "",
    ...defaultValues,
  };

  return (
    <form action={formAction} className="max-w-3xl space-y-6">
      <div>
        <label htmlFor="subject" className={labelClass}>
          Sujet
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          required
          maxLength={150}
          defaultValue={initial.subject}
          placeholder="L'essentiel du week-end sportif"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500">
          150 caractères maximum. C&apos;est la ligne que verront les abonnés dans leur boîte.
        </p>
      </div>

      <div>
        <label htmlFor="previewText" className={labelClass}>
          Pré-en-tête (facultatif)
        </label>
        <input
          id="previewText"
          name="previewText"
          type="text"
          maxLength={200}
          defaultValue={initial.previewText}
          placeholder="Le texte affiché à côté du sujet par les clients de messagerie."
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="listId" className={labelClass}>
          Liste de diffusion
        </label>
        <select id="listId" name="listId" required defaultValue={initial.listId} className={inputClass}>
          {lists.length === 0 ? <option value="">Aucune liste active</option> : null}
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
              {list.active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">
          Seuls les abonnés <strong>confirmés</strong> de cette liste recevront la campagne.
        </p>
      </div>

      <div>
        <label htmlFor="contentHtml" className={labelClass}>
          Contenu HTML
        </label>
        <textarea
          id="contentHtml"
          name="contentHtml"
          required
          rows={16}
          defaultValue={initial.contentHtml}
          placeholder={PLACEHOLDER_HTML}
          className={`${inputClass} resize-y font-mono text-xs leading-5`}
        />
        <p className="mt-1 text-xs text-neutral-500">
          HTML brut : titres, paragraphes, listes et liens (les styles en ligne sont conservés tels
          quels). La mise en page de l&apos;e-mail — bandeau, pied de page, lien de désabonnement —
          est ajoutée automatiquement.
        </p>
      </div>

      <div>
        <label htmlFor="scheduledAt" className={labelClass}>
          Planifier l&apos;envoi (facultatif)
        </label>
        <input
          id="scheduledAt"
          name="scheduledAt"
          type="datetime-local"
          defaultValue={initial.scheduledAt}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500">
          Sans date, la campagne reste en brouillon. Avec une date, elle passe « planifiée » et
          partira à l&apos;échéance, via l&apos;endpoint de cron.
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={isPending}
          className="rounded-lg bg-primary-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <button
          type="submit"
          name="intent"
          value="preview"
          disabled={isPending}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-primary-300 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Enregistrer et prévisualiser
        </button>
        <Link
          href={campaignId ? `/backoffice/newsletter/campaigns/${campaignId}` : "/backoffice/newsletter/campaigns"}
          className="text-sm font-semibold text-neutral-600 underline transition-colors hover:text-neutral-900"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
