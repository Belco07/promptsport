"use client";

import { useState, useTransition } from "react";

import { deleteCategory } from "./actions";

/**
 * Bouton de suppression d'une catégorie, avec confirmation native.
 * La Server Action renvoie un éventuel message d'erreur (catégorie référencée).
 */
export function DeleteCategoryButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!window.confirm(`Supprimer la catégorie « ${name} » ?`)) {
            return;
          }
          setError(null);
          const formData = new FormData();
          formData.set("id", id);
          startTransition(async () => {
            const result = await deleteCategory(formData);
            if (!result.ok) {
              setError(result.error);
            }
          });
        }}
        className="text-red-700 underline transition-colors hover:text-red-900 disabled:opacity-50"
      >
        {isPending ? "Suppression…" : "Supprimer"}
      </button>
      {error ? (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}
