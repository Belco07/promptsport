"use client";

import { useOptimistic, useState, useTransition } from "react";

import { reactToComment } from "@/app/article/[slug]/actions";
import {
  PUBLIC_COMMENT_REACTIONS,
  REACTION_EMOJI,
  REACTION_LABELS,
  type ReactionCounts,
  type ReactionType,
} from "@/lib/engagement";

/**
 * Réactions sur un commentaire (WP10b) : 👍 Like, ❤️ Love, 😂 Laugh.
 *
 * UI optimiste : le compteur bouge immédiatement (`useOptimistic`), puis l'état
 * renvoyé par la Server Action fait foi. En cas de refus (session expirée,
 * bannissement, commentaire retiré), l'état optimiste est abandonné et le
 * message d'erreur s'affiche.
 *
 * Composant client par nécessité : une réaction est une interaction immédiate.
 */

type State = { counts: ReactionCounts; mine: ReactionType | null };

export function CommentReactions({
  commentId,
  initialCounts,
  initialMine,
  canReact,
  disabledReason = "Connectez-vous pour réagir",
}: {
  commentId: string;
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

    // Cliquer à nouveau sur la réaction déjà posée la retire.
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
      const result = await reactToComment(commentId, type);
      if (result.ok && result.state) {
        setState(result.state);
      } else if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {PUBLIC_COMMENT_REACTIONS.map((type) => {
        const count = optimistic.counts[type] ?? 0;
        const active = optimistic.mine === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => react(type)}
            disabled={!canReact || isPending}
            title={canReact ? REACTION_LABELS[type] : disabledReason}
            aria-pressed={active}
            aria-label={`${REACTION_LABELS[type]} (${count})`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              active
                ? "border-brand-300 bg-brand-50 text-brand-700"
                : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
            }`}
          >
            <span aria-hidden="true">{REACTION_EMOJI[type]}</span>
            <span className="tabular-nums">{count}</span>
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
