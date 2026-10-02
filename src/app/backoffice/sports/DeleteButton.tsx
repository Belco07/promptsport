"use client";

import { useState, useTransition } from "react";

type DeleteResult = { ok: true } | { ok: false; error: string };

/**
 * Bouton de suppression générique avec confirmation, pour les entités sportives.
 */
export function DeleteButton({
  action,
  id,
  label,
}: {
  action: (formData: FormData) => Promise<DeleteResult>;
  id: string;
  label: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(`Supprimer « ${label} » ?`)) return;
          setError(null);
          const formData = new FormData();
          formData.set("id", id);
          startTransition(async () => {
            const result = await action(formData);
            if (!result.ok) setError(result.error);
          });
        }}
        className="text-red-700 underline transition-colors hover:text-red-900 disabled:opacity-50"
      >
        {isPending ? "Suppression…" : "Supprimer"}
      </button>
      {error ? <span role="alert" className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
