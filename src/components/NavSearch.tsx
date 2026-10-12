"use client";

import { Search, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SearchResults } from "@/lib/search";

export function NavSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function keepOpen() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const pathname = usePathname();
  const router = useRouter();
  const q = query.trim();
  const href = `/recherche?q=${encodeURIComponent(q)}`;

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    setResults(null); setError("");
    if (!open || q.length < 2) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=6`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Recherche indisponible. Réessayez.");
        if (!controller.signal.aborted) setResults(data);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Recherche indisponible.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, open]);

  return <div ref={container} onMouseEnter={keepOpen}
    onMouseLeave={() => { closeTimer.current = setTimeout(() => { if (!container.current?.contains(document.activeElement)) setOpen(false); }, 250); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} type="button" aria-label="Ouvrir la recherche" aria-expanded={open} aria-controls="nav-search-panel"
      onClick={() => { setOpen(true); requestAnimationFrame(() => input.current?.focus()); }}
      className="group flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted hover:text-editorial-link focus-visible:outline-2 focus-visible:outline-editorial-link">
      <Search aria-hidden="true" strokeWidth={1.8} className="h-[22px] w-[22px] transition-transform group-hover:scale-110 motion-reduce:transform-none" />
    </button>
    {open && <div id="nav-search-panel" onMouseEnter={keepOpen} className="absolute inset-x-0 top-full z-50 px-3 sm:px-4">
      <div className="max-h-[calc(100dvh-110px)] overflow-y-auto rounded-b-md border border-border border-t-2 border-t-editorial-link bg-card p-5 text-foreground shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-widest text-editorial-link">Explorer PromptSport</p><h2 className="mt-1 text-xl font-bold sm:text-2xl">Toute l’actualité à portée de recherche</h2></div>
          <button type="button" aria-label="Fermer la recherche" onClick={() => { setOpen(false); trigger.current?.focus(); }} className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-muted"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        <form role="search" className="max-w-2xl" onSubmit={event => { event.preventDefault(); if (q.length >= 2) { setOpen(false); router.push(href); } }}>
          <label htmlFor="nav-search-input" className="sr-only">Rechercher un article, un auteur, un mot-clé</label>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-editorial-link">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input ref={input} id="nav-search-input" type="search" value={query} maxLength={200} autoComplete="off"
              placeholder="Article, auteur, mot-clé…" onChange={event => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent py-3 text-sm text-foreground outline-none" />
            <button type="submit" disabled={q.length < 2} aria-label="Afficher tous les résultats" className="p-1 disabled:opacity-30"><ArrowRight aria-hidden="true" className="h-5 w-5" /></button>
          </div>
        </form>
        <div aria-live="polite" role="status" className="mt-3 text-sm text-muted-foreground">
          {q.length < 2 ? "Saisissez au moins 2 caractères." : loading ? "Recherche…" : error || (results ? results.total ? `${results.total} résultat${results.total > 1 ? "s" : ""}` : "Aucun résultat." : "")}
        </div>
        {results && results.articles.length > 0 && <ul className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{results.articles.map(article => <li key={article.id}>
          <Link href={`/article/${article.slug}`} onClick={() => setOpen(false)} className="group flex h-full gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted focus-visible:outline-2 sm:block sm:overflow-hidden sm:p-0">
            <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-sm bg-muted sm:w-full sm:rounded-none">
              {article.coverImageUrl ? <Image src={article.coverImageUrl} alt="" fill sizes="(max-width: 639px) 112px, (max-width: 1023px) 45vw, 350px" className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none" /> : <span className="absolute inset-0 flex items-center justify-center text-xs font-bold uppercase tracking-wide text-muted-foreground">PromptSport</span>}
            </span>
            <span className="block sm:p-4">
              <span className="text-[11px] font-bold uppercase tracking-wide text-editorial-link">{article.category.name}</span>
              <span className="mt-1 block text-sm font-bold leading-snug group-hover:text-editorial-link sm:text-base">{article.title}</span>
              <span className="mt-2 block text-xs text-muted-foreground">{article.author.name}</span>
            </span>
          </Link>
        </li>)}</ul>}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
          {results && results.total > 0 ? <Link href={href} onClick={() => setOpen(false)} className="text-sm font-semibold text-editorial-link">Voir tous les résultats →</Link> : <span />}
        </div>
      </div>
    </div>}
  </div>;
}
