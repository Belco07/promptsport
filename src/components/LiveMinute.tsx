"use client";

import { useEffect, useState } from "react";

/** Estimated display between snapshots; never requests the sports provider. */
export function LiveMinute({ minute, observedAt, periodEnd }: { minute: string | null; observedAt?: string | null; periodEnd?: number | null }) {
  const [elapsed, setElapsed] = useState(0);
  const numeric = minute?.match(/^(\d{1,3})(?:\+(\d{1,2}))?['′]?$/);
  useEffect(() => {
    setElapsed(0);
    if (!numeric) return;
    const received = observedAt ? Date.parse(observedAt) : Date.now();
    if (!Number.isFinite(received)) return;
    const tick = () => {
      if (document.hidden) return;
      const age = Math.max(0, Date.now() - received);
      // A stale feed is not evidence that a match has kept playing for hours.
      setElapsed(age < 900000 ? Math.floor(age / 60000) : 0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
    // Parsing is derived entirely from minute; no dependency on a new array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute, observedAt]);
  if (!numeric) return <>{minute ?? "LIVE"}</>;
  const base = Number(numeric[1]), extra = numeric[2] ? Number(numeric[2]) : null;
  const boundary=periodEnd??(base<45?45:base<=90?90:null);
  const value = extra !== null ? `${base}+${extra + elapsed}` : boundary!==null&&base+elapsed>boundary ? `${boundary}+${base+elapsed-boundary}` : String(base + elapsed);
  return <span title="Temps estimé entre deux mises à jour"><span suppressHydrationWarning>{value}</span><span aria-hidden="true" className="animate-pulse motion-reduce:animate-none">′</span><span className="sr-only"> minutes, estimation entre deux mises à jour</span></span>;
}
