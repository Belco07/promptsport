"use client";

import { useActionState, useEffect, useRef } from "react";
import { createMatchComment } from "@/app/match/[id]/actions";

export function MatchCommentForm({ matchId, parentId, phase, onPosted }: { matchId: string; parentId?: string; phase?: string; onPosted?: () => void }) {
  const [state, action, pending] = useActionState(createMatchComment.bind(null, matchId), { ok: false, message: "", savedId: "" });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.savedId) { form.current?.reset(); onPosted?.(); }
  }, [state.ok, state.savedId, onPosted]);
  const fieldId = `match-comment-input-${parentId ?? "new"}`;
  return <form ref={form} action={action} className="space-y-3 rounded-xl border border-border bg-card p-4">
    {phase && <input type="hidden" name="phase" value={phase} />}
    {parentId && <input type="hidden" name="parentId" value={parentId} />}
    <label htmlFor={fieldId} className="block font-semibold text-foreground">{parentId ? "Votre réponse" : "Votre commentaire"}</label>
    <textarea id={fieldId} name="content" required minLength={1} maxLength={1000} rows={3} className="w-full rounded-lg border border-border bg-background p-3 text-foreground" aria-describedby={`${fieldId}-help`} />
    <p id={`${fieldId}-help`} className="text-xs text-muted-foreground">1 000 caractères maximum. Respectez les autres participants.</p>
    {state.message && <p role={state.ok ? "status" : "alert"} className="text-sm text-foreground">{state.message}</p>}
    <button disabled={pending} className="min-h-11 rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground disabled:opacity-50">{pending ? "Envoi…" : parentId ? "Envoyer la réponse" : "Publier mon commentaire"}</button>
  </form>;
}
