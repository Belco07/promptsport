"use client";

import { useActionState } from "react";

import { createList, updateList } from "@/app/backoffice/newsletter/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";

/**
 * Formulaire de liste de diffusion, en création comme en édition.
 *
 * Composant client : `useActionState` affiche les erreurs de validation (nom
 * trop court, description trop longue, doublon d'identifiant d'URL) sans perdre
 * la saisie. Sans JavaScript, le formulaire poste normalement — le repli est le
 * comportement par défaut de React pour une action de formulaire.
 */

export type NewsletterListValues = {
  name: string;
  description: string;
  active: boolean;
};

export function ListForm({
  mode,
  listId,
  defaultValues,
}: {
  mode: "create" | "edit";
  /** Identifiant de la liste en édition. */
  listId?: string;
  defaultValues?: Partial<NewsletterListValues>;
}) {
  const action = mode === "create" ? createList : updateList.bind(null, listId ?? "");
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial: NewsletterListValues = {
    name: "",
    description: "",
    active: true,
    ...defaultValues,
  };

  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <Input
        id={`list-name-${mode}`}
        name="name"
        type="text"
        label="Nom de la liste"
        required
        minLength={2}
        maxLength={120}
        defaultValue={initial.name}
        placeholder="Hebdo Football"
        hint="Le nom apparaît dans le formulaire public et dans les campagnes."
      />

      <Textarea
        id={`list-description-${mode}`}
        name="description"
        label="Description (facultatif)"
        rows={3}
        maxLength={300}
        defaultValue={initial.description}
        placeholder="Le meilleur du football européen, chaque lundi."
        hint="Affichée sous le nom, dans le formulaire d'inscription et les préférences des abonnés."
      />

      <label
        htmlFor={`list-active-${mode}`}
        className="flex items-center gap-2.5 text-sm font-medium text-neutral-800"
      >
        <input
          id={`list-active-${mode}`}
          name="active"
          type="checkbox"
          defaultChecked={initial.active}
          className="h-4 w-4 rounded border-neutral-300"
        />
        Liste active
      </label>
      <p className="pl-6 text-xs text-neutral-500">
        Une liste inactive ne peut plus être rejointe et ne reçoit plus de campagne. Décochez-la
        plutôt que de la supprimer pour conserver son historique.
      </p>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Enregistrement…" : mode === "create" ? "Créer la liste" : "Enregistrer"}
      </Button>
    </form>
  );
}
