"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Navigation du bandeau : les liens et les données restent rendus côté serveur. */
export function ScoresScroller({ children, autoScroll = false }: { children: ReactNode; autoScroll?: boolean }) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const interacting = useRef(false);
  const focused = useRef(false);
  const [paused, setPaused] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setEdges({
      start: list.scrollLeft <= 2,
      end: list.scrollLeft + list.clientWidth >= list.scrollWidth - 2,
    });
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => { list.removeEventListener("scroll", update); observer.disconnect(); };
  }, [children]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !autoScroll || paused) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, position = list.scrollLeft;
    function tick(time: number) {
      if (!list) return;
      const elapsed = last ? Math.min(time-last, 50) : 0;
      last = time;
      if (motion.matches || interacting.current || focused.current || document.hidden) {
        position = list.scrollLeft;
      } else {
        const end = list.scrollWidth-list.clientWidth;
        if (end > 1 && position < end) {
          position = Math.min(end, position+elapsed*0.022);
          list.scrollLeft = position;
        }
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, paused, children]);

  function scroll(direction: number) {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({
      left: direction * Math.max(220, list.clientWidth * .8),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }

  return (
    <div className="scores-scroller" onMouseEnter={() => { interacting.current = true; }} onMouseLeave={() => { interacting.current = false; }} onFocusCapture={() => { focused.current = true; }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) focused.current = false; }} onTouchStart={() => { interacting.current = true; }} onTouchEnd={() => { interacting.current = false; }}>
      <button type="button" className="scores-scroll-button" aria-label="Matchs précédents" aria-controls={listId} disabled={edges.start} onClick={() => scroll(-1)}>
        <ChevronLeft size={17} aria-hidden="true" />
      </button>
      <ul ref={listRef} id={listId} className="scores-scroll-list" style={autoScroll ? { scrollSnapType: "none" } : undefined} tabIndex={0} aria-label="Matchs : faites défiler avec les flèches du clavier">
        {children}
      </ul>
      {autoScroll && !(edges.start && edges.end) && <button type="button" className="scores-scroll-button" aria-label={paused ? "Reprendre le défilement automatique" : "Suspendre le défilement automatique"} aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}</button>}
      <button type="button" className="scores-scroll-button" aria-label="Matchs suivants" aria-controls={listId} disabled={edges.end} onClick={() => scroll(1)}>
        <ChevronRight size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
