"use client";

import { useActionState } from "react";

import { createLiveUpdate } from "@/app/studio/live/[matchId]/actions";

type State = { ok: boolean; message: string };

const typeLabels: Record<string, string> = {
  TEXT: "Éditorial",
  GOAL: "But",
  CARD: "Carton",
  SUB: "Remplacement",
  KEY_MOMENT: "Moment clé",
};

/**
 * Formulaire rapide de publication d'une intervention en direct (WP38) :
 * champ texte, minute et type d'événement. Fonctionne sans JavaScript
 * (progressive enhancement) grâce à la Server Action.
 */
export function StudioLiveForm({ matchId }: { matchId: string }) {
  const [state, formAction, isPending] = useActionState<State, FormData>(
    createLiveUpdate.bind(null, matchId),
    { ok: false, message: "" },
  );

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <label htmlFor="live-content" className="mb-1 block text-sm font-medium text-foreground">
          Commentaire en direct
        </label>
        <textarea
          id="live-content"
          name="content"
          required
          minLength={1}
          maxLength={500}
          rows={3}
          className="w-full rounded-lg border border-border bg-background p-3 text-foreground"
        />
        <p className="mt-1 text-xs text-muted-foreground">500 caractères maximum.</p>
        {state.message && (
          <p
            id="live-status"
            role={state.ok ? "status" : "alert"}
            className={`mt-2 text-sm ${
              state.ok
                ? "text-status-success-foreground"
                : "text-status-error-foreground"
            }`}
          >
            {state.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="live-minute" className="mb-1 block text-sm font-medium text-foreground">
            Minute
          </label>
          <input
            id="live-minute"
            name="minute"
            type="number"
            min={0}
            max={150}
            placeholder="Ex. 23"
            className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Laisser vide si l&apos;intervention n&apos;est pas chronom&eacute;tr&eacute;e.
          </p>
        </div>
        <div>
          <label htmlFor="live-type" className="mb-1 block text-sm font-medium text-foreground">
            Type d&eacute;v&eacute;nement
          </label>
          <select
            id="live-type"
            name="type"
            defaultValue="TEXT"
            className="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground"
          >
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isPending ? "Publie…" : "Publier"}
          </button>
        </div>
      </div>
    </form>
  );
}
