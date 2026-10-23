"use client";

import { Bookmark, LoaderCircle } from "@/components/icons";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getBookmarkStates, toggleBookmark } from "@/app/article/[slug]/actions";

type BookmarkState = { id: string; slug: string; saved: boolean };
type Waiting = { key: string; resolve: (state: BookmarkState | null) => void };
let queued: Waiting[] = [];
let scheduled = false;

// Cards can be rendered inside client components: coalesce their reads into one action.
function readBookmark(key: string): Promise<BookmarkState | null> {
  return new Promise(resolve => {
    queued.push({ key, resolve });
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(async () => {
      scheduled = false;
      const batch = queued;
      queued = [];
      const keys = [...new Set(batch.map(item => item.key))];
      const articles: BookmarkState[] = [];
      try {
        for (let offset = 0; offset < keys.length; offset += 100) {
          const result = await getBookmarkStates(keys.slice(offset, offset + 100));
          articles.push(...result.articles);
        }
      } catch { /* A failed read must not expose another user's saved state. */ }
      for (const item of batch) item.resolve(articles.find(article => article.id === item.key || article.slug === item.key) ?? null);
    });
  });
}

export function BookmarkButton({ articleId, articleSlug, initial, showLabel = false }: {
  articleId?: string; articleSlug?: string; initial?: BookmarkState | null; showLabel?: boolean;
}) {
  const key = articleSlug ?? articleId ?? "";
  const [state, setState] = useState<BookmarkState | null | undefined>(initial);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (initial !== undefined || !key) return;
    let active = true;
    readBookmark(key).then(value => { if (active) setState(value); });
    return () => { active = false; };
  }, [initial, key]);

  useEffect(() => {
    function onChange(event: Event) {
      const value = (event as CustomEvent<BookmarkState>).detail;
      if (value.id === articleId || value.slug === articleSlug || value.id === key || value.slug === key) setState(value);
    }
    window.addEventListener("bookmark-changed", onChange);
    return () => window.removeEventListener("bookmark-changed", onChange);
  }, [articleId, articleSlug, key]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!state) return null;
  const label = state.saved ? "Retirer des favoris" : "Sauvegarder l’article";
  return <>
    <button type="button" aria-label={label} aria-pressed={state.saved} title={label} disabled={pending || !ready}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${state.saved ? "border-accent bg-muted text-editorial-link" : "border-border bg-card text-muted-foreground hover:text-editorial-link"}`}
      onClick={() => {
        setError("");
        start(async () => {
          try {
            const result = await toggleBookmark(state.id);
            if (!result.ok) { setError(result.message); return; }
            const next = { ...state, saved: result.saved };
            setState(next);
            window.dispatchEvent(new CustomEvent("bookmark-changed", { detail: next }));
            setMessage(result.message);
            if (pathname === "/mon-compte/favoris") router.refresh();
          } catch { setError("La sauvegarde a échoué. Réessayez."); }
        });
      }}>
      {pending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Bookmark aria-hidden="true" className={`h-4 w-4 ${state.saved ? "fill-current" : ""}`} />}
      {showLabel && <span>{state.saved ? "Retirer des favoris" : "Sauvegarder"}</span>}
    </button>
    {message && <p role="status" className="fixed bottom-24 right-4 z-50 max-w-xs rounded-xl border border-border bg-card p-4 text-sm text-foreground shadow-lg">{message}</p>}
    {error && <p role="alert" className="text-sm text-status-error-foreground">{error}</p>}
  </>;
}
