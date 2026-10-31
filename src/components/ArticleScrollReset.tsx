"use client";

import { useLayoutEffect } from "react";

let previousSlug: string | null = null;
let historyTarget: string | null = null;
let navigating = false;
const positions = new Map<string, number>();

function remember(slug: string) {
  positions.delete(slug);
  positions.set(slug, window.scrollY);
  if (positions.size > 40) positions.delete(positions.keys().next().value!);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (previousSlug && !navigating) remember(previousSlug);
    historyTarget = window.location.pathname;
    navigating = true;
  });
}

/** Restore article history after its loading placeholder has been replaced. */
export function ArticleScrollReset({ slug }: { slug: string }) {
  useLayoutEffect(() => {
    const changedArticle = previousSlug !== null && previousSlug !== slug;
    const fromHistory = historyTarget === window.location.pathname;
    const target = fromHistory ? positions.get(slug) : undefined;
    previousSlug = slug;
    historyTarget = null;
    navigating = false;
    let frame = 0, attempts = 0;
    if (!window.location.hash) {
      if (target !== undefined) {
        // Next's short loading view can clamp native history restoration.
        // Wait for the article layout and the router's own scroll handling.
        const restore = () => {
          window.scrollTo({ top: target, left: 0, behavior: "instant" });
          if (Math.abs(window.scrollY - target) > 2 && ++attempts < 120) frame = requestAnimationFrame(restore);
        };
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(restore); });
      } else if (changedArticle && !fromHistory) {
        window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      }
    }
    const scroll = () => { if (!navigating) remember(slug); };
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
        remember(slug);
        navigating = true;
      }
    };
    window.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("click", leave, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scroll);
      document.removeEventListener("click", leave, true);
    };
  }, [slug]);
  return null;
}
