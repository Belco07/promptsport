"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveCommentFeed } from "@/components/LiveCommentFeed";
import { MatchCommentForm, type PostedMatchComment } from "@/components/MatchCommentForm";
import { MatchCommentItem, type MatchThreadComment } from "@/components/MatchCommentItem";
import { getMatchDiscussion } from "@/app/match/[id]/actions";

const phases = [{ key: "PRE_MATCH", label: "Avant-match" }, { key: "LIVE", label: "En direct" }, { key: "POST_MATCH", label: "Après-match" }] as const;
export function MatchThread({ matchId, live, phase, counts, comments, userId, banned, currentPhase }: {
  matchId: string; live: boolean; phase: string; counts: Record<string, number>; comments: MatchThreadComment[];
  userId: string | null; banned: boolean; currentPhase: string;
}) {
  const searchParams = useSearchParams();
  const requested = searchParams.get("phase");
  const selectedPhase = phases.some(item => item.key === requested) ? requested! : phase;
  const [loaded, setLoaded] = useState<{ source: MatchThreadComment[]; data: Awaited<ReturnType<typeof getMatchDiscussion>> } | null>(null);
  const [error, setError] = useState("");
  const snapshot = selectedPhase === phase ? { comments, counts, userId, banned } : loaded?.source === comments && loaded.data.phase === selectedPhase ? loaded.data : null;
  useEffect(() => {
    if (selectedPhase === phase) return;
    let active = true;
    setError("");
    getMatchDiscussion(matchId, selectedPhase).then(data => {
      if (active) setLoaded({ source: comments, data });
    }).catch(() => { if (active) setError("Impossible de charger cette discussion. Réessayez en sélectionnant l’onglet."); });
    return () => { active = false; };
  }, [matchId, selectedPhase, phase, comments]);
  const visibleComments = snapshot?.comments ?? [];
  const visibleCounts = snapshot?.counts ?? counts;
  const contextKey = `${matchId}:${userId ?? "guest"}`;
  const [posted, setPosted] = useState<{ contextKey: string; source: MatchThreadComment[]; comments: PostedMatchComment[] }>({ contextKey, source: comments, comments: [] });
  const onPosted = useCallback((comment: PostedMatchComment) => {
    setPosted(previous => ({ contextKey, source: comments, comments: [comment, ...(previous.contextKey === contextKey && previous.source === comments ? previous.comments.filter(item => item.id !== comment.id) : [])] }));
  }, [contextKey, comments]);
  // A new server snapshot is authoritative (moderation, deletion, navigation).
  const additions = posted.contextKey === contextKey && posted.source === comments ? posted.comments.filter(item => item.phase === selectedPhase && !visibleComments.some(comment => comment.id === item.id)) : [];
  const displayedComments = [...additions, ...visibleComments];
  const displayedCounts = { ...visibleCounts };
  for (const comment of additions) displayedCounts[comment.phase] = (displayedCounts[comment.phase] ?? 0) + 1;
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const tabs = useRef<Array<HTMLAnchorElement | null>>([]);
  return <div id="discussion" className="space-y-5">
    <LiveCommentFeed live={live} />
    <div role="tablist" aria-busy={!ready || !snapshot} aria-label="Phases de la discussion" className="flex gap-2 overflow-x-auto border-b border-border">
      {phases.map((item, index) => <Link scroll={false} key={item.key} ref={node => { tabs.current[index] = node; }} role="tab" id={`phase-${item.key}`} aria-selected={selectedPhase === item.key} aria-controls="thread-panel" tabIndex={selectedPhase === item.key ? 0 : -1} href={`/match/${matchId}?tab=discussion&phase=${item.key}`} onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        window.history.pushState(null, "", `/match/${matchId}?tab=discussion&phase=${item.key}`);
      }} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
        if (next !== null) {
          event.preventDefault();
          // Use the same Next Link navigation (including its transition state)
          // for mouse and keyboard activation.
          tabs.current[next]?.focus();
          tabs.current[next]?.click();
        }
      }} className={`min-h-11 shrink-0 border-b-2 px-3 py-3 text-sm font-bold ${selectedPhase === item.key ? "border-editorial-link text-editorial-link" : "border-transparent text-muted-foreground"}`}>{item.label} ({displayedCounts[item.key] ?? 0})</Link>)}
    </div>
    <div id="thread-panel" role="tabpanel" aria-busy={!snapshot} aria-labelledby={`phase-${selectedPhase}`} tabIndex={0} className="space-y-4">
      {error ? <p role="alert">{error}</p> : !snapshot ? <p role="status">Chargement de la discussion…</p> : displayedComments.length ? displayedComments.map(comment => <MatchCommentItem key={comment.id} comment={comment} matchId={matchId} userId={snapshot.userId} onPosted={onPosted} />) : <p className="text-muted-foreground">Aucun commentaire pour cette phase. Lancez la discussion !</p>}
      {(displayedCounts[selectedPhase] ?? 0) > displayedComments.length && <p className="text-sm text-muted-foreground">Les 50 commentaires les plus récents sont affichés.</p>}
    </div>
    <p className="text-sm text-muted-foreground">Les nouveaux messages rejoignent la phase actuelle : {phases.find(item => item.key === currentPhase)?.label}.</p>
    {!userId ? <p><Link href={`/login?callbackUrl=${encodeURIComponent(`/match/${matchId}?tab=discussion`)}`} className="text-editorial-link underline">Connectez-vous</Link> pour participer à la discussion.</p> : banned ? <p role="status" className="text-muted-foreground">Votre compte est suspendu et ne peut pas commenter.</p> : <MatchCommentForm matchId={matchId} onPosted={onPosted} />}
  </div>;
}
