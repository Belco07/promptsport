"use client";

import Link from "next/link";
import { useRef } from "react";
import { LiveCommentFeed } from "@/components/LiveCommentFeed";
import { MatchCommentForm } from "@/components/MatchCommentForm";
import { MatchCommentItem, type MatchThreadComment } from "@/components/MatchCommentItem";

const phases = [{ key: "PRE_MATCH", label: "Avant-match" }, { key: "LIVE", label: "En direct" }, { key: "POST_MATCH", label: "Après-match" }] as const;
export function MatchThread({ matchId, live, phase, counts, comments, userId, banned, currentPhase }: {
  matchId: string; live: boolean; phase: string; counts: Record<string, number>; comments: MatchThreadComment[];
  userId: string | null; banned: boolean; currentPhase: string;
}) {
  const available = phases.filter(item => phases.findIndex(p => p.key === item.key) <= phases.findIndex(p => p.key === currentPhase));
  const tabs = useRef<Array<HTMLAnchorElement | null>>([]);
  return <div id="discussion" className="space-y-5">
    <LiveCommentFeed live={live} />
    <div role="tablist" aria-label="Phases de la discussion" style={{ gridTemplateColumns: `repeat(${available.length}, minmax(0, 1fr))` }} className="grid gap-1 border-b border-border">
      {available.map((item, index) => <Link scroll={false} key={item.key} ref={node => { tabs.current[index] = node; }} role="tab" id={`phase-${item.key}`} aria-selected={phase === item.key} aria-controls="thread-panel" tabIndex={phase === item.key ? 0 : -1} href={`/match/${matchId}?tab=discussion&phase=${item.key}`} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % available.length : event.key === "ArrowLeft" ? (index + available.length - 1) % available.length : event.key === "Home" ? 0 : event.key === "End" ? available.length - 1 : null;
        if (next !== null) { event.preventDefault(); tabs.current[next]?.focus(); tabs.current[next]?.click(); }
      }} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 border-b-2 px-1 py-3 text-center text-xs font-bold leading-snug sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${phase === item.key ? "border-editorial-link text-editorial-link" : "border-transparent text-muted-foreground"}`}><span>{item.label}</span><span className="tabular-nums">({counts[item.key] ?? 0})</span></Link>)}
    </div>
    <div id="thread-panel" role="tabpanel" aria-labelledby={`phase-${phase}`} tabIndex={0} className="space-y-4">
      {comments.length ? comments.map(comment => <MatchCommentItem key={comment.id} comment={comment} matchId={matchId} userId={userId} canReply={phase === currentPhase && !banned} />) : <p className="text-muted-foreground">Aucun commentaire pour cette phase. Lancez la discussion !</p>}
      {(counts[phase] ?? 0) > comments.length && <p className="text-sm text-muted-foreground">Les 50 commentaires les plus récents sont affichés.</p>}
    </div>
    <p className="text-sm text-muted-foreground">Les nouveaux messages rejoignent la phase actuelle : {phases.find(item => item.key === currentPhase)?.label}.</p>
    {phase !== currentPhase ? <p className="text-sm text-muted-foreground">Cette phase est terminée. Les nouveaux commentaires sont ouverts dans la phase actuelle.</p> : !userId ? <p><Link href={`/login?callbackUrl=${encodeURIComponent(`/match/${matchId}?tab=discussion`)}`} className="text-editorial-link underline">Connectez-vous</Link> pour participer à la discussion.</p> : banned ? <p role="status" className="text-muted-foreground">Votre compte est suspendu et ne peut pas commenter.</p> : <MatchCommentForm matchId={matchId} phase={currentPhase} />}
  </div>;
}
