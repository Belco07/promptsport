import Link from "next/link";

import { CommentForm, type CommentNotice, type ReplyTarget } from "@/components/CommentForm";
import { CommentReactions } from "@/components/CommentReactions";
import { CommentsDisclosure } from "@/components/CommentsDisclosure";
import { ReportModal } from "@/components/ReportModal";
import {
  COMMENT_SORT_LABELS,
  COMMENTS_PAGE_SIZE,
  COMMENT_SORTS,
  isReactionType,
  type CommentSort,
  type ReactionCounts,
  type ReactionType,
} from "@/lib/engagement";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";

/**
 * Section de commentaires d'un article (WP10b, complément).
 *
 * Composant serveur : il lit les commentaires approuvés, applique le tri et la
 * pagination demandés par l'URL, puis délègue l'interaction aux composants
 * clients (réactions optimistes, signalement).
 *
 * Pagination incrémentale : `?commentsPage=2` affiche les deux premières pages
 * (« Voir plus de commentaires »), sans numéros de page.
 */

type CommentRow = {
  id: string;
  content: string;
  createdAt: Date;
  authorId: string;
  author: { name: string };
};

function CommentBlock({
  comment,
  slug,
  counts,
  mine,
  replies,
  replyCounts,
  replyMine,
  viewerId,
  canReact,
  disabledReason,
}: {
  comment: CommentRow;
  slug: string;
  counts: ReactionCounts;
  mine: ReactionType | null;
  replies: CommentRow[];
  replyCounts: Map<string, ReactionCounts>;
  replyMine: Map<string, ReactionType>;
  viewerId: string | null;
  canReact: boolean;
  disabledReason: string;
}) {
  // Disposition de la référence : avatar rond à gauche, nom et date, texte,
  // actions ; les commentaires sont séparés par un filet, sans carte.
  return (
    <article className="flex gap-4 border-b border-border py-6">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-foreground">
        {comment.author.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="text-sm font-bold text-foreground">{comment.author.name}</span>
        <time dateTime={comment.createdAt.toISOString()}>{formatDate(comment.createdAt)}</time>
      </p>

      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground">{comment.content}</p>

      <div className="mt-1 flex flex-wrap items-center gap-4">
        <CommentReactions
          commentId={comment.id}
          initialCounts={counts}
          initialMine={mine}
          canReact={canReact}
          disabledReason={disabledReason}
        />
        {/* WP10d : répondre à un commentaire racine. Un visiteur non connecté
            est envoyé vers la connexion avec retour sur l'article, plutôt que de
            découvrir un formulaire qu'il ne peut pas utiliser.
            `prefetch={false}` : le formulaire dépend du paramètre `?repondre=`,
            on préfère une navigation fraîche à un éventuel rendu en cache. */}
        {viewerId ? (
          <Link
            href={`/article/${slug}?repondre=${comment.id}#commentaires`}
            prefetch={false}
            className="text-xs font-semibold text-muted-foreground underline transition-colors hover:text-foreground"
          >
            Répondre
          </Link>
        ) : (
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(`/article/${slug}?repondre=${comment.id}`)}`}
            className="text-xs font-semibold text-muted-foreground underline transition-colors hover:text-foreground"
          >
            Se connecter pour répondre
          </Link>
        )}
        {viewerId && viewerId !== comment.authorId ? (
          <ReportModal commentId={comment.id} canReport />
        ) : (
          <ReportModal commentId={comment.id} canReport={false} disabledReason="Signaler un commentaire nécessite un compte" />
        )}
      </div>

      {replies.length > 0 ? (
        <ol className="mt-5 space-y-5 border-l-2 border-border pl-5">
          {replies.map((reply) => (
            <li key={reply.id}>
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="text-sm font-bold text-foreground">{reply.author.name}</span>
                <time dateTime={reply.createdAt.toISOString()}>{formatDate(reply.createdAt)}</time>
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-foreground">
                {reply.content}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-4">
                <CommentReactions
                  commentId={reply.id}
                  initialCounts={replyCounts.get(reply.id) ?? {}}
                  initialMine={replyMine.get(reply.id) ?? null}
                  canReact={canReact}
                  disabledReason={disabledReason}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      </div>
    </article>
  );
}

export async function CommentsSection({
  articleId,
  slug,
  sort,
  page,
  viewerId,
  viewerName = null,
  isBanned,
  banMessage,
  notice,
  replyTo = null,
  defaultOpen = false,
}: {
  articleId: string;
  slug: string;
  sort: CommentSort;
  page: number;
  viewerId: string | null;
  /** Nom de la personne connectée, pour « Connecté en tant que … ». */
  viewerName?: string | null;
  /** Bloc déplié d'emblée (retour de formulaire, réponse, tri ou pagination). */
  defaultOpen?: boolean;
  isBanned: boolean;
  banMessage: string;
  notice: CommentNotice;
  /** Identifiant du commentaire auquel on répond (`?repondre=`), WP10d. */
  replyTo?: string | null;
}) {
  const whereRoots = { articleId, status: "APPROVED" as const, parentId: null };
  const orderBy =
    sort === "liked"
      ? { reactions: { _count: "desc" as const } }
      : sort === "oldest"
        ? { createdAt: "asc" as const }
        : { createdAt: "desc" as const };

  // Pagination incrémentale : la page N montre les N premières pages.
  const take = page * COMMENTS_PAGE_SIZE;

  const [total, roots] = await Promise.all([
    prisma.comment.count({ where: whereRoots }),
    prisma.comment.findMany({
      where: whereRoots,
      orderBy,
      take,
      select: {
        id: true,
        content: true,
        createdAt: true,
        authorId: true,
        author: { select: { name: true } },
      },
    }),
  ]);

  // Cible de réponse (`?repondre=`) : cherchée indépendamment de la pagination,
  // pour que le formulaire reste utilisable même si le commentaire visé n'est pas
  // dans la tranche affichée.
  const replyTargetRow = replyTo
    ? await prisma.comment.findFirst({
        where: { id: replyTo, articleId, status: "APPROVED", parentId: null },
        select: { id: true, content: true, author: { select: { name: true } } },
      })
    : null;

  const replyTarget: ReplyTarget | null = replyTargetRow
    ? {
        id: replyTargetRow.id,
        authorName: replyTargetRow.author.name,
        content: replyTargetRow.content,
      }
    : null;

  const replies = roots.length
    ? await prisma.comment.findMany({
        where: { parentId: { in: roots.map((root) => root.id) }, status: "APPROVED" },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          content: true,
          createdAt: true,
          authorId: true,
          parentId: true,
          author: { select: { name: true } },
        },
      })
    : [];

  const allIds = [...roots.map((root) => root.id), ...replies.map((reply) => reply.id)];

  const [grouped, mineRows] = allIds.length
    ? await Promise.all([
        prisma.commentReaction.groupBy({
          by: ["commentId", "type"],
          where: { commentId: { in: allIds } },
          _count: { _all: true },
        }),
        viewerId
          ? prisma.commentReaction.findMany({
              where: { authorId: viewerId, commentId: { in: allIds } },
              select: { commentId: true, type: true },
            })
          : Promise.resolve([]),
      ])
    : [[], []];

  const countsByComment = new Map<string, ReactionCounts>();
  for (const group of grouped) {
    if (!isReactionType(group.type)) continue;
    const counts = countsByComment.get(group.commentId) ?? {};
    counts[group.type] = group._count._all;
    countsByComment.set(group.commentId, counts);
  }

  const mineByComment = new Map<string, ReactionType>();
  for (const row of mineRows) {
    if (isReactionType(row.type)) {
      mineByComment.set(row.commentId, row.type);
    }
  }

  const repliesOf = (parentId: string) => replies.filter((reply) => reply.parentId === parentId);
  const canInteract = Boolean(viewerId) && !isBanned;
  const disabledReason = !viewerId
    ? "Connectez-vous pour réagir"
    : "Votre compte est temporairement banni";

  const sortHref = (target: CommentSort) =>
    `/article/${slug}?commentsSort=${target}#commentaires`;
  const moreHref = `/article/${slug}?commentsSort=${sort}&commentsPage=${page + 1}#commentaires`;

  return (
    <section
      id="commentaires"
      aria-labelledby="titre-commentaires"
      className="border-t border-border py-9"
    >
      {/* Disposition de la référence : titre à gauche, bouton arrondi à droite ;
          la discussion et le formulaire se déplient au clic. */}
      <CommentsDisclosure
        defaultOpen={defaultOpen}
        summary={
          <>
            <h2 id="titre-commentaires" className="text-lg font-black text-foreground">
              {total > 0 ? `${total} commentaire${total > 1 ? "s" : ""}` : "Laisser un commentaire"}
            </h2>
            <span className="inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-[21px] bg-muted px-5 text-sm font-bold text-foreground transition-colors hover:bg-border sm:px-8">
              <span className="group-open:hidden">{total > 0 ? "Afficher les commentaires" : "Laisser un commentaire"}</span>
              <span className="hidden group-open:inline">Masquer</span>
            </span>
          </>
        }
      >
      <div className="mt-6">
      {total > 0 ? (
        <nav aria-label="Tri des commentaires" className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trier :</span>
          {COMMENT_SORTS.map((option) => (
            <Link
              key={option}
              href={sortHref(option)}
              aria-current={option === sort ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                option === sort
                  ? "border-accent bg-secondary text-editorial-link"
                  : "border-border bg-card text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {COMMENT_SORT_LABELS[option]}
            </Link>
          ))}
        </nav>
      ) : null}

      {roots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun commentaire publié pour le moment. Soyez le premier à réagir.
        </p>
      ) : (
        <>
          <ol>
            {roots.map((comment) => (
              <li key={comment.id}>
                <CommentBlock
                  comment={comment}
                  slug={slug}
                  counts={countsByComment.get(comment.id) ?? {}}
                  mine={mineByComment.get(comment.id) ?? null}
                  replies={repliesOf(comment.id)}
                  replyCounts={countsByComment}
                  replyMine={mineByComment}
                  viewerId={viewerId}
                  canReact={canInteract}
                  disabledReason={disabledReason}
                />
              </li>
            ))}
          </ol>

          {take < total ? (
            <p className="mt-6 text-center">
              <Link
                href={moreHref}
                className="inline-flex h-10 items-center gap-2 rounded-[21px] bg-muted px-8 text-sm font-bold text-foreground transition-colors hover:bg-border"
              >
                Voir plus de commentaires ({total - take} restants)
              </Link>
            </p>
          ) : null}
        </>
      )}

      {/* Formulaire après la discussion, comme sur la référence. */}
      <CommentForm
        slug={slug}
        isLoggedIn={Boolean(viewerId)}
        viewerName={viewerName}
        isBanned={isBanned}
        banMessage={banMessage}
        notice={notice}
        replyTo={replyTarget}
      />
      </div>
      </CommentsDisclosure>
    </section>
  );
}
