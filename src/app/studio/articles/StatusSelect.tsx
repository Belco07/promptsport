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
  hasCover = true,
  isVeille = false,
}: {
  articleId: string;
  currentStatus: ArticleStatus;
  allowedStatuses: ArticleStatus[];
  /** L'article possède une couverture ; sinon la publication demande confirmation. */
  hasCover?: boolean;
  /** L'article provient de la veille : exception de publication sans visuel. */
  isVeille?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <select
        value={currentStatus}
        disabled={isPending}
        aria-label="Statut de l'article"
        onChange={(event) => {
          const select = event.currentTarget;
          const newStatus = select.value as ArticleStatus;
          if (newStatus === currentStatus) {
            return;
          }
          let confirmWithoutCover = false;
          if (newStatus === "PUBLISHED" && !hasCover) {
            if (!isVeille) {
              window.alert("Ajoutez une photo de couverture avant de publier cet article.");
              select.value = currentStatus;
              return;
            }
            if (!window.confirm("Ce brouillon de veille n'a aucun visuel. Publier quand même sans couverture ?")) {
              // Le select est contrôlé par `currentStatus` : sans re-rendu, il
              // resterait affiché sur « Publié » alors que rien n'a changé.
              select.value = currentStatus;
              return;
            }
            confirmWithoutCover = true;
          }
          startTransition(async () => {
            await updateArticleStatus(articleId, newStatus, { confirmWithoutCover });
          });
        }}
        className="rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground outline-none focus:border-editorial-link focus:ring-1 focus:ring-blue-600 disabled:opacity-60"
      >
        {allowedStatuses.map((status) => (
          <option key={status} value={status}>
            {ARTICLE_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      {isPending ? <span className="text-xs text-muted-foreground">…</span> : null}
    </div>
  );
}
