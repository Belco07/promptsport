"use client";

import { useTransition } from "react";

import { deleteArticle } from "./actions";

/**
 * Bouton de suppression avec confirmation native (window.confirm).
 * La mutation passe par la Server Action deleteArticle ; la liste est
 * rafraîchie par revalidatePath côté serveur.
 */
export function DeleteArticleButton({ id, title }: { id: string; title: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(`Supprimer définitivement « ${title} » ?`)) {
          return;
        }
        const formData = new FormData();
        formData.set("id", id);
        startTransition(async () => {
          await deleteArticle(formData);
        });
      }}
      className="text-red-700 underline transition-colors hover:text-red-900 disabled:opacity-50"
    >
      {isPending ? "Suppression…" : "Supprimer"}
    </button>
  );
}
