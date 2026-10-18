"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveCommentFeed } from "@/components/LiveCommentFeed";
import { MatchCommentForm } from "@/components/MatchCommentForm";
import { MatchCommentItem, type MatchThreadComment } from "@/components/MatchCommentItem";

const phases = [{ key: "PRE_MATCH", label: "Avant-match" }, { key: "LIVE", label: "En direct" }, { key: "POST_MATCH", label: "Après-match" }] as const;
export function MatchThread({ matchId, live, phase, counts, comments, userId, banned, currentPhase }: {
  matchId: string; live: boolean; phase: string; counts: Record<string, number>; comments: MatchThreadComment[];
  userId: string | null; banned: boolean; currentPhase: string;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const tabs = useRef<Array<HTMLAnchorElement | null>>([]);
  return <div id="discussion" className="space-y-5">
    <LiveCommentFeed live={live} />
    <div role="tablist" aria-busy={!ready} aria-label="Phases de la discussion" className="flex gap-2 overflow-x-auto border-b border-border">
      {phases.map((item, index) => <Link scroll={false} key={item.key} ref={node => { tabs.current[index] = node; }} role="tab" id={`phase-${item.key}`} aria-selected={phase === item.key} aria-controls="thread-panel" tabIndex={phase === item.key ? 0 : -1} href={`/match/${matchId}?tab=discussion&phase=${item.key}`} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
        if (next !== null) { event.preventDefault(); tabs.current[next]?.focus(); router.push(`/match/${matchId}?tab=discussion&phase=${phases[next].key}`, { scroll: false }); }
      }} className={`min-h-11 shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${phase === item.key ? "border-editorial-link text-editorial-link" : "border-transparent text-muted-foreground"}`}>{item.label} ({counts[item.key] ?? 0})</Link>)}
    </div>
    <div id="thread-panel" role="tabpanel" aria-labelledby={`phase-${phase}`} tabIndex={0} className="space-y-4">
      {comments.length ? comments.map(comment => <MatchCommentItem key={comment.id} comment={comment} matchId={matchId} userId={userId} />) : <p className="text-muted-foreground">Aucun commentaire pour cette phase. Lancez la discussion !</p>}
      {(counts[phase] ?? 0) > comments.length && <p className="text-sm text-muted-foreground">Les 50 commentaires les plus récents sont affichés.</p>}
    </div>
    <p className="text-sm text-muted-foreground">Les nouveaux messages rejoignent la phase actuelle : {phases.find(item => item.key === currentPhase)?.label}.</p>
    {!userId ? <p><Link href={`/login?callbackUrl=${encodeURIComponent(`/match/${matchId}?tab=discussion`)}`} className="text-editorial-link underline">Connectez-vous</Link> pour participer à la discussion.</p> : banned ? <p role="status" className="text-muted-foreground">Votre compte est suspendu et ne peut pas commenter.</p> : <MatchCommentForm matchId={matchId} />}
  </div>;
}
