"use client";

import Link from "next/link";
import { useActionState } from "react";

import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/roles";

type UserFormProps = {
  action: (
    previousState: string | undefined,
    formData: FormData,
  ) => Promise<string | undefined>;
  /** true = création (mot de passe requis), false = édition (mot de passe non modifiable). */
  mode: "create" | "edit";
  defaultValues?: { name: string; email: string; role: string };
  submitLabel: string;
};

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

export function UserForm({ action, mode, defaultValues, submitLabel }: UserFormProps) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = { name: "", email: "", role: "JOURNALIST", ...defaultValues };

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div>
        <label htmlFor="name" className={labelClass}>
          Nom
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={initial.name}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          defaultValue={initial.email}
          className={inputClass}
        />
      </div>

      {mode === "create" ? (
        <div>
          <label htmlFor="password" className={labelClass}>
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-500">
            Au moins 6 caractères. La réinitialisation viendra plus tard.
          </p>
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          Le mot de passe n&apos;est pas modifiable ici.
        </p>
      )}

      <div>
        <label htmlFor="role" className={labelClass}>
          Rôle
        </label>
        <select id="role" name="role" defaultValue={initial.role} className={inputClass}>
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {USER_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>

      {mode === "create" ? (
        // Case décochée par défaut : l'abonnement à la newsletter est un choix,
        // jamais une conséquence automatique de la création d'un compte (WP11c).
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
          <label
            htmlFor="newsletter"
            className="flex items-center gap-2 text-sm font-medium text-gray-800"
          >
            <input
              id="newsletter"
              name="newsletter"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-600"
            />
            Recevoir la newsletter
          </label>
          <p className="mt-1 pl-6 text-xs text-gray-500">
            L&apos;abonnement est créé en statut « confirmé » : l&apos;adresse du compte est vérifiée
            par la création du compte. La personne pourra gérer ses listes depuis chaque e-mail.
          </p>
        </div>
      ) : null}

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link
          href="/backoffice/users"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
