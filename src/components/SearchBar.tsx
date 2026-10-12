"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [value, setValue] = useState(query);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestParams = useRef(params);
  latestParams.current = params;
  // A completed older navigation must not overwrite text still being typed.
  useEffect(() => { if (!pending && !timer.current) setValue(query); }, [query, pending]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function search(nextValue: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = new URLSearchParams(latestParams.current.toString());
    const q = nextValue.trim();
    if (q) next.set("q", q); else next.delete("q");
    next.delete("page");
    if (next.toString() === latestParams.current.toString()) return;
    startTransition(() => router.replace(`/recherche${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  return <form role="search" onSubmit={(event) => { event.preventDefault(); search(value); }} aria-busy={pending} className="space-y-2">
    <label htmlFor="article-search" className="block text-sm font-semibold text-foreground">Votre recherche</label>
    <div className="flex flex-wrap gap-2">
      <input id="article-search" name="q" type="search" maxLength={200} value={value}
        placeholder="Rechercher un article, un auteur, un mot-clé…"
        className="min-w-0 basis-full rounded-md border border-border bg-card px-4 py-3 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-editorial-link sm:flex-1 sm:basis-auto"
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => search(next), 300);
        }} />
      <button type="submit" className="rounded-md bg-foreground px-5 py-3 font-semibold text-background">Rechercher</button>
      <button type="button" onClick={() => { setValue(""); search(""); }} className="rounded-md border border-border bg-card px-4 py-3 font-semibold text-foreground hover:bg-muted">Effacer</button>
    </div>
  </form>;
}
