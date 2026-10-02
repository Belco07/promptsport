"use client";

import Link from "next/link";
import { useActionState } from "react";

import { subscribeToNewsletter, type SubscribeState } from "@/app/newsletter/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/**
 * Formulaire d'inscription à la newsletter (WP11c).
 *
 * Composant client par nécessité : `useActionState` affiche le compte rendu
 * (inscription enregistrée, adresse déjà connue, consentement manquant, limite
 * atteinte) sans rechargement, et l'état d'attente pendant l'envoi de l'e-mail.
 *
 * Le formulaire reste utilisable sans JavaScript : `useActionState` produit un
 * `<form action=…>` classique, et la Server Action répond alors par une page
 * complète.
 *
 * Aucun jeton ne transite par ce composant : il n'est transmis que par e-mail.
 */

export type NewsletterListOption = {
  id: string;
  name: string;
  description: string | null;
};

export function NewsletterForm({
  lists,
  /** Listes pré-cochées (aucune par défaut : le choix doit être explicite). */
  defaultListIds = [],
}: {
  lists: NewsletterListOption[];
  defaultListIds?: string[];
}) {
  const [state, formAction, isPending] = useActionState<SubscribeState | undefined, FormData>(
    subscribeToNewsletter,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-5">
      <Input
        id="email"
        name="email"
        type="email"
        label="Adresse e-mail"
        required
        autoComplete="email"
        placeholder="prenom.nom@exemple.fr"
        hint="Nous n'utilisons cette adresse que pour la newsletter."
      />

      <Input
        id="name"
        name="name"
        type="text"
        label="Nom (facultatif)"
        maxLength={80}
        autoComplete="name"
        hint="Il personnalise l'accueil de nos e-mails."
      />

      <fieldset>
        <legend className="text-sm font-semibold text-neutral-800">Vos listes</legend>
        <p className="mt-1 text-xs text-neutral-500">
          Aucune liste n&apos;est cochée par défaut : vous choisissez ce que vous recevez.
        </p>
        {lists.length === 0 ? (
          <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
            Aucune liste de diffusion n&apos;est ouverte pour le moment.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {lists.map((list) => (
              <li key={list.id} className="flex items-start gap-2.5">
                <input
                  id={`liste-${list.id}`}
                  name="listes"
                  type="checkbox"
                  value={list.id}
                  defaultChecked={defaultListIds.includes(list.id)}
                  className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                />
                <label htmlFor={`liste-${list.id}`} className="text-sm text-neutral-800">
                  <span className="font-medium">{list.name}</span>
                  {list.description ? (
                    <span className="block text-xs text-neutral-500">{list.description}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <label htmlFor="consentement" className="flex items-start gap-2.5 text-sm text-neutral-800">
          <input
            id="consentement"
            name="consentement"
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4 rounded border-neutral-300"
          />
          <span>
            J&apos;accepte de recevoir des e-mails et j&apos;ai lu la{" "}
            <Link
              href="/confidentialite"
              className="font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
            >
              politique de confidentialité
            </Link>
            .
          </span>
        </label>
        <p className="mt-2 pl-6 text-xs text-neutral-500">
          Cette case n&apos;est pas cochée par défaut. Vous devrez confirmer votre adresse par
          e-mail (double opt-in), et chaque message contient un lien de désabonnement.
        </p>
      </div>

      {state ? (
        <p
          role={state.code === "ok" || state.code === "already" ? "status" : "alert"}
          className={`rounded-lg border px-4 py-3 text-sm font-medium ${
            state.code === "ok" || state.code === "already"
              ? "border-success-200 bg-success-50 text-success-800"
              : "border-danger-200 bg-danger-50 text-danger-700"
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Inscription en cours…" : "S'inscrire"}
      </Button>
    </form>
  );
}
