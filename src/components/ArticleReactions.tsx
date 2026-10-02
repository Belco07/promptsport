"use client";

import { useOptimistic, useState, useTransition } from "react";

import { reactToArticle } from "@/app/article/[slug]/actions";
import {
  ARTICLE_REACTION_TYPES,
  PUBLIC_REACTION_COUNTERS,
  REACTION_EMOJI,
  REACTION_LABELS,
  type ReactionCounts,
  type ReactionType,
} from "@/lib/engagement";

/**
 * Réactions sur un article (WP10b) : 👍 Like, ❤️ Love, 🔖 Bookmark.
 *
 * Le Bookmark est privé : il n'affiche aucun compteur public, seulement l'état
 * « Enregistré » de la personne connectée (son affichage dans l'espace abonné
 * relève d'un lot ultérieur). UI optimiste, comme les réactions de commentaire.
 */

type State = { counts: ReactionCounts; mine: ReactionType | null };

const BOOKMARK_LABELS = {
  saved: "Enregistré",
  save: "Enregistrer",
} as const;

export function ArticleReactions({
  articleId,
  initialCounts,
  initialMine,
  canReact,
  disabledReason = "Connectez-vous pour réagir",
}: {
  articleId: string;
  initialCounts: ReactionCounts;
  initialMine: ReactionType | null;
  canReact: boolean;
  disabledReason?: string;
}) {
  const [state, setState] = useState<State>({ counts: initialCounts, mine: initialMine });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [optimistic, applyOptimistic] = useOptimistic(state, (current: State, action: ReactionType) => {
    const counts: ReactionCounts = { ...current.counts };
    const previous = current.mine;

    if (previous) {
      counts[previous] = Math.max(0, (counts[previous] ?? 0) - 1);
    }

    const next: ReactionType | null = previous === action ? null : action;
    if (next) {
      counts[next] = (counts[next] ?? 0) + 1;
    }

    return { counts, mine: next };
  });

  function react(type: ReactionType) {
    if (!canReact) return;
    setError(null);

    startTransition(async () => {
      applyOptimistic(type);
      const result = await reactToArticle(articleId, type);
      if (result.ok && result.state) {
        setState(result.state);
      } else if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ARTICLE_REACTION_TYPES.map((type) => {
        const active = optimistic.mine === type;
        const showCount = PUBLIC_REACTION_COUNTERS.includes(type);
        const count = optimistic.counts[type] ?? 0;

        return (
          <button
            key={type}
            type="button"
            onClick={() => react(type)}
            disabled={!canReact || isPending}
            title={canReact ? REACTION_LABELS[type] : disabledReason}
            aria-pressed={active}
            aria-label={
              showCount ? `${REACTION_LABELS[type]} (${count})` : REACTION_LABELS[type]
            }
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
            }`}
          >
            <span aria-hidden="true">{REACTION_EMOJI[type]}</span>
            {showCount ? (
              <span className="tabular-nums">{count}</span>
            ) : (
              <span>{active ? BOOKMARK_LABELS.saved : BOOKMARK_LABELS.save}</span>
            )}
          </button>
        );
      })}

      {error ? (
        <p role="alert" className="w-full text-xs font-medium text-danger-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
