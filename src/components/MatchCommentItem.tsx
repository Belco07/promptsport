"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteMatchComment } from "@/app/match/[id]/actions";
import { MatchCommentForm } from "@/components/MatchCommentForm";

export type MatchThreadComment = {
  id: string; content: string; createdAt: string; status: string;
  name: string; ownerId: string | null; parentId: string | null;
  parentName: string | null;
};
export function MatchCommentItem({ comment, matchId, userId }: { comment: MatchThreadComment; matchId: string; userId: string | null }) {
  const router = useRouter();
  const [reply, setReply] = useState(false);
  const [message, setMessage] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [pending, start] = useTransition();
  if (deleted) return <p role="status" className="text-sm text-muted-foreground">Commentaire supprimé.</p>;
  return <article id={`match-comment-${comment.id}`} className="rounded-xl border border-border bg-card p-4 transition-colors motion-reduce:transition-none">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-bold text-foreground">{comment.name}</span><time dateTime={comment.createdAt} className="text-muted-foreground">{new Date(comment.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" })}</time></div>
    {comment.parentId && <p className="mt-2 text-xs text-muted-foreground">En réponse à {comment.parentName ?? "un participant"}</p>}
    {comment.status === "PENDING" && <p className="mt-2 text-xs text-muted-foreground">En attente de modération · visible uniquement par vous</p>}
    <p className="mt-3 whitespace-pre-wrap break-words text-foreground">{comment.content}</p>
    <div className="mt-2 flex gap-4">
      {userId && comment.status === "APPROVED" && !comment.parentId && <button type="button" aria-expanded={reply} onClick={() => setReply(!reply)} className="min-h-11 text-sm font-semibold text-editorial-link">{reply ? "Annuler la réponse" : "Répondre"}</button>}
      {userId === comment.ownerId && <button disabled={pending} onClick={() => start(async () => { const result = await deleteMatchComment(matchId, comment.id); setMessage(result.message); if (result.ok) { setDeleted(true); router.refresh(); } })} className="min-h-11 text-sm text-muted-foreground">Supprimer mon commentaire</button>}
    </div>
    {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    {reply && <MatchCommentForm matchId={matchId} parentId={comment.id} />}
  </article>;
}
