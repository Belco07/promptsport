"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = { hasLiveMatches: boolean; lastSync?: string | null; showControls?: boolean; pauseWhenIdle?: boolean; watchForKickoff?: boolean };
const interval = 30000;
const inactivity = 300000;

export function LiveScoreRefresher({ hasLiveMatches, lastSync = null, showControls = false, pauseWhenIdle = true, watchForKickoff = false }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [serverSync, setServerSync] = useState(lastSync);
  const [failed, setFailed] = useState(false);
  const updated = useRef(0);
  const activity = useRef(0);
  const refreshDue = useRef(0);
  const busy = useRef(false);
  const refresh = useRef<() => void>(() => {});

  useEffect(() => { setServerSync(lastSync); }, [lastSync]);
  useEffect(() => {
    if (pending) return;
    if (updated.current) {
      updated.current = Date.now();
      setSeconds(0);
    }
  }, [pending]);

  useEffect(() => {
    if (!hasLiveMatches && !watchForKickoff) return;
    const delay = hasLiveMatches ? interval : 60000;
    let disposed = false;
    const controller = new AbortController();
    updated.current = Date.now();
    activity.current = Date.now();
    refreshDue.current = Date.now() + delay;
    const perform = async () => {
      if (busy.current || document.hidden || disposed) return;
      busy.current = true;
      refreshDue.current = Date.now() + delay;
      try {
        const response = await fetch("/api/sync-status", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) throw new Error("Statut indisponible");
        const status = await response.json();
        if (disposed) return;
        if (status.lastSync !== null && typeof status.lastSync !== "string") throw new Error("Statut invalide");
        setServerSync(status.lastSync);
        setFailed(false);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        busy.current = false;
      }
      if (!disposed && !document.hidden) startTransition(() => router.refresh());
    };
    refresh.current = () => {
      activity.current = Date.now();
      setPaused(false);
      void perform();
    };
    const resume = () => { activity.current = Date.now(); };
    const tick = () => {
      if (document.hidden) { setPaused(true); return; }
      const idle = pauseWhenIdle && Date.now() - activity.current >= inactivity;
      setPaused(idle);
      if (idle) return;
      setSeconds(Math.floor((Date.now() - updated.current) / 1000));
      if (Date.now() >= refreshDue.current) void perform();
    };
    const visibility = () => {
      if (!document.hidden) resume();
      tick();
    };
    const timer = window.setInterval(tick, 1000);
    const events = ["pointermove", "pointerdown", "keydown", "scroll"] as const;
    events.forEach(event => window.addEventListener(event, resume, { passive: true }));
    document.addEventListener("visibilitychange", visibility);
    tick();
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      events.forEach(event => window.removeEventListener(event, resume));
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [hasLiveMatches, router, pauseWhenIdle, watchForKickoff]);

  // Refresh effects remain active; the reader-facing pages render no controls.
  if (!hasLiveMatches || !showControls) return null;
  const age = serverSync ? Math.max(0, Math.floor((Date.now() - Date.parse(serverSync)) / 60000)) : null;
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
    <div><p aria-live="polite" aria-atomic="true">{paused ? "Actualisation en pause" : pending ? "Actualisation…" : `Actualisé il y a ${seconds} seconde${seconds === 1 ? "" : "s"}`}</p><p className="mt-1">Dernière mise à jour serveur : <span suppressHydrationWarning>{age !== null ? `il y a ${age} min` : "aucune synchronisation enregistrée"}</span>{failed ? " · statut temporairement indisponible" : ""}</p></div>
    <button type="button" disabled={pending} onClick={() => refresh.current()} className="rounded border border-border bg-card px-3 py-2 font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">Actualiser maintenant</button>
  </div>;
}
