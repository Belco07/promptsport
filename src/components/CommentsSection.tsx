import Link from "next/link";

import { CommentForm, type CommentNotice, type ReplyTarget } from "@/components/CommentForm";
import { CommentReactions } from "@/components/CommentReactions";
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
  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
        <span className="font-semibold text-neutral-800">{comment.author.name}</span>
        <time dateTime={comment.createdAt.toISOString()}>{formatDate(comment.createdAt)}</time>
      </p>

      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-neutral-700">{comment.content}</p>

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
            className="text-xs font-semibold text-neutral-500 underline transition-colors hover:text-neutral-800"
          >
            Répondre
          </Link>
        ) : (
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(`/article/${slug}?repondre=${comment.id}`)}`}
            className="text-xs font-semibold text-neutral-500 underline transition-colors hover:text-neutral-800"
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
        <ol className="mt-4 space-y-4 border-l-2 border-neutral-100 pl-4">
          {replies.map((reply) => (
            <li key={reply.id}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                <span className="font-semibold text-neutral-800">{reply.author.name}</span>
                <time dateTime={reply.createdAt.toISOString()}>{formatDate(reply.createdAt)}</time>
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-6 text-neutral-700">
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
    </article>
  );
}

export async function CommentsSection({
  articleId,
  slug,
  sort,
  page,
  viewerId,
  isBanned,
  banMessage,
  notice,
  replyTo = null,
}: {
  articleId: string;
  slug: string;
  sort: CommentSort;
  page: number;
  viewerId: string | null;
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
      className="mt-14 border-t border-neutral-200 pt-10"
    >
      <h2
        id="titre-commentaires"
        className="mb-6 text-2xl font-extrabold tracking-tight text-primary-900"
      >
        Commentaires ({total})
      </h2>

      <CommentForm
        slug={slug}
        isLoggedIn={Boolean(viewerId)}
        isBanned={isBanned}
        banMessage={banMessage}
        notice={notice}
        replyTo={replyTarget}
      />

      {total > 0 ? (
        <nav aria-label="Tri des commentaires" className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Trier :</span>
          {COMMENT_SORTS.map((option) => (
            <Link
              key={option}
              href={sortHref(option)}
              aria-current={option === sort ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                option === sort
                  ? "border-brand-300 bg-brand-50 text-brand-700"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
              }`}
            >
              {COMMENT_SORT_LABELS[option]}
            </Link>
          ))}
        </nav>
      ) : null}

      {roots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
          Aucun commentaire publié pour le moment.
        </p>
      ) : (
        <>
          <ol className="space-y-5">
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
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 transition-colors hover:border-neutral-400"
              >
                Voir plus de commentaires ({total - take} restants)
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
