"use client";

import { useTransition } from "react";

import { updateArticleStatus } from "@/app/studio/articles/actions";
import { ARTICLE_STATUS_LABELS, type ArticleStatus } from "@/lib/articleStatus";

/**
 * Sélecteur de statut pour la liste des articles.
 *
 * Les statuts proposés sont calculés côté serveur (`allowedArticleStatuses`) :
 * un journaliste ne voit que « Brouillon » et « En revue » sur ses propres
 * articles non publiés, un article publié n'est plus modifiable par son auteur.
 * La Server Action applique les mêmes règles, le composant ne fait que les
 * refléter.
 */
export function StatusSelect({
  articleId,
  currentStatus,
  allowedStatuses,
}: {
  articleId: string;
  currentStatus: ArticleStatus;
  allowedStatuses: ArticleStatus[];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <select
        value={currentStatus}
        disabled={isPending}
        aria-label="Statut de l'article"
        onChange={(event) => {
          const newStatus = event.target.value as ArticleStatus;
          if (newStatus === currentStatus) {
            return;
          }
          startTransition(async () => {
            await updateArticleStatus(articleId, newStatus);
          });
        }}
        className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:opacity-60"
      >
        {allowedStatuses.map((status) => (
          <option key={status} value={status}>
            {ARTICLE_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      {isPending ? <span className="text-xs text-gray-400">…</span> : null}
    </div>
  );
}
