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
  "w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-editorial-link focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-foreground";

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
          <p className="mt-1 text-xs text-muted-foreground">
            Au moins 6 caractères. La réinitialisation viendra plus tard.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
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
        <div className="rounded-md border border-border bg-muted p-4">
          <label
            htmlFor="newsletter"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id="newsletter"
              name="newsletter"
              type="checkbox"
              className="h-4 w-4 rounded border-border text-editorial-link focus:ring-blue-600"
            />
            Recevoir la newsletter
          </label>
          <p className="mt-1 pl-6 text-xs text-muted-foreground">
            L&apos;abonnement est créé en statut « confirmé » : l&apos;adresse du compte est vérifiée
            par la création du compte. La personne pourra gérer ses listes depuis chaque e-mail.
          </p>
        </div>
      ) : null}

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link
          href="/backoffice/users"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
