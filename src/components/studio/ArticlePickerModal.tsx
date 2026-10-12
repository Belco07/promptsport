"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { findFeaturedArticles } from "@/app/studio/une/actions";
import type { PickerArticle } from "@/lib/featured";

export function ArticlePickerModal({ label, feedback, onClose, onSelect }: { label: string; feedback: string; onClose: () => void; onSelect: (id: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [articles, setArticles] = useState<PickerArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      findFeaturedArticles(query).then(result => {
        if (active) { setArticles(result.articles); setError(result.error ?? ""); setLoading(false); }
      }).catch(() => { if (active) { setError("Impossible de charger les articles."); setLoading(false); } });
    }, query ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <dialog ref={dialog} aria-labelledby="article-picker-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto max-h-[85vh] w-[min(640px,94vw)] overflow-y-auto rounded-md border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-black/60">
    <div className="mb-5 flex items-center justify-between gap-4"><h2 id="article-picker-title" className="text-xl font-bold">Choisir un article — {label}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Fermer le sélecteur d’articles" className="rounded-md border border-border px-3 py-2">Fermer</button></div>
    <label className="block text-sm font-semibold">Rechercher par titre<input autoFocus type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground" /></label>
    <p role="status" className="my-3 text-sm text-muted-foreground">{loading ? "Chargement…" : error || `${articles.length} article(s) publié(s) — les 10 plus récents`}</p>
    {feedback && <p role="alert" className="my-3 text-sm text-status-error-foreground">{feedback}</p>}
    {!loading && !error && !articles.length && <p>Aucun article trouvé.</p>}
    <ul className="space-y-2">{!loading && articles.map(article => <li key={article.id}>
      <button type="button" disabled={busy} aria-label={`Choisir ${article.title} pour ${label}`} onClick={async () => { setBusy(true); try { await onSelect(article.id); } finally { setBusy(false); } }} className="flex w-full items-center gap-3 rounded-md border border-border p-3 text-left hover:bg-muted disabled:opacity-50">
        {article.coverImageUrl && <Image src={article.coverImageUrl} alt="" width={80} height={48} className="h-12 w-20 shrink-0 object-cover" />}
        <span><span className="block font-semibold">{article.title}</span><span className="text-xs text-muted-foreground">{article.publishedAt ? new Date(article.publishedAt).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : ""}</span></span>
      </button>
    </li>)}</ul>
  </dialog>;
}
