import Link from "next/link";

import { createComment } from "@/app/article/[slug]/actions";
import { COMMENT_MAX_LENGTH, commentExcerpt } from "@/lib/engagement";

/**
 * Formulaire de dépôt d'un commentaire (WP10b), utilisé aussi pour répondre à un
 * commentaire existant (WP10d).
 *
 * Composant serveur : le formulaire poste directement la Server Action
 * `createComment`, qui applique la validation, le refus des auteurs bannis et la
 * limitation de débit (10 commentaires par heure). Les messages (confirmation,
 * bannissement, limite atteinte, contenu invalide) sont affichés au-dessus,
 * construits par la page à partir du paramètre d'URL `commentaire`.
 *
 * En mode réponse (`replyTo`), un champ caché `parentId` est ajouté : la
 * validation du parent reste côté serveur, le formulaire n'est qu'une aide.
 */

export type CommentNotice = { type: "success" | "error"; text: string } | null;

export type ReplyTarget = { id: string; authorName: string; content: string };

export function CommentForm({
  slug,
  isLoggedIn,
  isBanned,
  banMessage,
  notice,
  replyTo = null,
}: {
  slug: string;
  isLoggedIn: boolean;
  isBanned: boolean;
  banMessage: string;
  notice: CommentNotice;
  replyTo?: ReplyTarget | null;
}) {
  return (
    <div className="mb-8">
      {notice ? (
        <p
          role={notice.type === "success" ? "status" : "alert"}
          className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
            notice.type === "success"
              ? "border-status-success-border bg-status-success text-status-success-foreground"
              : "border-status-error-border bg-status-error text-status-error-foreground"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {!isLoggedIn ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          <Link href="/login" className="font-semibold text-editorial-link underline">
            Connectez-vous
          </Link>{" "}
          pour participer à la discussion.
        </p>
      ) : isBanned ? (
        <p className="rounded-lg border border-status-error-border bg-status-error px-4 py-3 text-sm font-medium text-status-error-foreground">
          {banMessage}
        </p>
      ) : (
        <form action={createComment} className="rounded-xl border border-border bg-card p-5">
          <input type="hidden" name="slug" value={slug} />
          {replyTo ? <input type="hidden" name="parentId" value={replyTo.id} /> : null}

          {replyTo ? (
            <div className="mb-4 rounded-lg border border-border bg-muted p-3">
              <p className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-foreground">
                <span>Réponse à {replyTo.authorName}</span>
                <Link
                  href={`/article/${slug}#commentaires`}
                  className="font-medium text-muted-foreground underline"
                >
                  Annuler
                </Link>
              </p>
              <p className="mt-1 text-xs italic text-muted-foreground">
                « {commentExcerpt(replyTo.content, 120)} »
              </p>
            </div>
          ) : null}

          <label htmlFor="champ-commentaire" className="block text-sm font-semibold text-foreground">
            {replyTo ? "Votre réponse" : "Votre commentaire"}
          </label>
          <textarea
            id="champ-commentaire"
            name="content"
            required
            rows={4}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder={
              replyTo
                ? "Répondez à ce commentaire, dans le respect des autres lecteurs."
                : "Partagez votre analyse, dans le respect des autres lecteurs."
            }
            className="mt-2 w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {COMMENT_MAX_LENGTH} caractères maximum · 10 commentaires par heure · publié après
              validation.
            </p>
            <button
              type="submit"
              className="rounded-lg bg-editorial-action px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-editorial-action"
            >
              {replyTo ? "Répondre" : "Publier"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
