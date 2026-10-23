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
  viewerName = null,
  isBanned,
  banMessage,
  notice,
  replyTo = null,
}: {
  slug: string;
  isLoggedIn: boolean;
  /** Nom affiché dans « Connecté en tant que … » (disposition de la référence). */
  viewerName?: string | null;
  isBanned: boolean;
  banMessage: string;
  notice: CommentNotice;
  replyTo?: ReplyTarget | null;
}) {
  return (
    <div className="mt-8">
      {/* Titre et note d'en-tête du formulaire, comme la référence. */}
      <h3 className="text-lg font-black text-foreground">
        {replyTo ? `Répondre à ${replyTo.authorName}` : "Laisser une réponse"}
      </h3>

      {notice ? (
        <p
          role={notice.type === "success" ? "status" : "alert"}
          className={`mt-4 rounded-[13px] border px-4 py-3 text-sm font-medium ${
            notice.type === "success"
              ? "border-status-success-border bg-status-success text-status-success-foreground"
              : "border-status-error-border bg-status-error text-status-error-foreground"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {!isLoggedIn ? (
        <p className="mt-2 text-[13px] text-muted-foreground">
          Vous devez être{" "}
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/article/${slug}#commentaires`)}`} className="font-semibold text-editorial-link underline">
            connecté
          </Link>{" "}
          pour publier un commentaire.
        </p>
      ) : isBanned ? (
        <p className="mt-4 rounded-[13px] border border-status-error-border bg-status-error px-4 py-3 text-sm font-medium text-status-error-foreground">
          {banMessage}
        </p>
      ) : (
        <form action={createComment} className="mt-2">
          <input type="hidden" name="slug" value={slug} />
          {replyTo ? <input type="hidden" name="parentId" value={replyTo.id} /> : null}

          <p className="text-[13px] text-muted-foreground">
            {viewerName ? (
              <>
                Connecté en tant que <span className="font-semibold text-foreground">{viewerName}</span>.{" "}
                <Link href="/mon-compte" className="underline hover:text-foreground">Modifier votre profil</Link>.{" "}
              </>
            ) : null}
            Votre commentaire sera publié après validation. Les champs obligatoires sont indiqués avec *
          </p>

          {replyTo ? (
            <div className="mt-4 rounded-[13px] bg-muted p-4">
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

          <label htmlFor="champ-commentaire" className="mt-5 block text-sm font-semibold text-foreground">
            {replyTo ? "Réponse *" : "Commentaire *"}
          </label>
          <textarea
            id="champ-commentaire"
            name="content"
            required
            rows={8}
            maxLength={COMMENT_MAX_LENGTH}
            placeholder={
              replyTo
                ? "Répondez à ce commentaire, dans le respect des autres lecteurs."
                : "Partagez votre analyse, dans le respect des autres lecteurs."
            }
            className="mt-2 w-full resize-y rounded-[21px] border-0 bg-muted px-5 py-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-editorial-link"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {COMMENT_MAX_LENGTH} caractères maximum · 10 commentaires par heure.
          </p>
          <button
            type="submit"
            className="mt-5 inline-flex !min-h-10 h-10 items-center !rounded-[13px] bg-foreground px-10 text-sm font-bold !normal-case !tracking-normal text-background transition-opacity hover:opacity-85"
          >
            {replyTo ? "Publier la réponse" : "Publier le commentaire"}
          </button>
        </form>
      )}
    </div>
  );
}
