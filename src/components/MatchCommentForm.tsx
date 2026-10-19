"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createMatchComment } from "@/app/match/[id]/actions";
import type { MatchThreadComment } from "@/components/MatchCommentItem";

export type PostedMatchComment = MatchThreadComment & { phase: string };

export function MatchCommentForm({ matchId, parentId, onPosted }: { matchId: string; parentId?: string; onPosted?: (comment: PostedMatchComment) => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createMatchComment.bind(null, matchId), { ok: false, message: "", savedId: "", comment: null });
  const form = useRef<HTMLFormElement>(null);
  const refreshedId = useRef("");
  useEffect(() => {
    if (!pending && state.ok && state.comment && refreshedId.current !== state.savedId) {
      refreshedId.current = state.savedId;
      form.current?.reset();
      if (onPosted) onPosted(state.comment);
      else router.refresh();
    }
  }, [pending, state.ok, state.savedId, state.comment, onPosted, router]);
  const fieldId = `match-comment-input-${parentId ?? "new"}`;
  return <form ref={form} action={action} className="space-y-3 rounded-xl border border-border bg-card p-4">
    {parentId && <input type="hidden" name="parentId" value={parentId} />}
    <label htmlFor={fieldId} className="block font-semibold text-foreground">{parentId ? "Votre réponse" : "Votre commentaire"}</label>
    <textarea id={fieldId} name="content" required minLength={1} maxLength={1000} rows={3} className="w-full rounded-lg border border-border bg-background p-3 text-foreground" aria-describedby={`${fieldId}-help`} />
    <p id={`${fieldId}-help`} className="text-xs text-muted-foreground">1 000 caractères maximum. Respectez les autres participants.</p>
    {state.message && <p role={state.ok ? "status" : "alert"} className="text-sm text-foreground">{state.message}</p>}
    <button disabled={pending} className="min-h-11 rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">{pending ? "Envoi…" : parentId ? "Envoyer la réponse" : "Publier mon commentaire"}</button>
  </form>;
}
