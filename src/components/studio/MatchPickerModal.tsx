"use client";

import { useEffect, useRef, useState } from "react";
import { searchMatches, suggestMatches, type MatchPickerOption } from "@/app/studio/articles/actions";

export function matchPickerLabel(match: MatchPickerOption): string {
  const score = match.homeScore !== null && match.awayScore !== null ? ` · ${match.homeScore} – ${match.awayScore}` : "";
  return `${match.homeName} – ${match.awayName}${score} · ${new Date(match.scheduledAt).toLocaleString("fr-FR", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" })}`;
}

/** Native modal dialog supplies Escape, focus trapping and background isolation. */
export function MatchPickerModal({ articleId, title, content, onSelect, onClose }: {
  articleId?: string; title: string; content: string;
  onSelect: (match: MatchPickerOption) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [suggestions, setSuggestions] = useState<MatchPickerOption[]>([]);
  const [results, setResults] = useState<MatchPickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const [suggested, found] = await Promise.all([
          suggestMatches(articleId, { title, content }), searchMatches(query, date),
        ]);
        if (!cancelled) {
          // Explicit filters narrow results; suggestions remain first when browsing.
          const visible = suggested.filter(match => (!date || new Date(match.scheduledAt).toLocaleDateString("en-CA", {timeZone:"Africa/Lagos"}) === date) && (!query.trim() || `${match.homeName} ${match.awayName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
          setSuggestions(visible);
          setResults(found.filter(match => !visible.some(s => s.id === match.id)).slice(0, 10-visible.length));
        }
      } catch { if (!cancelled) { setError("Impossible de charger les matchs. Réessayez en modifiant la recherche."); setResults([]); setSuggestions([]); } }
      finally { if (!cancelled) setLoading(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [articleId, title, content, query, date]);

  function options(matches: MatchPickerOption[], suggested: boolean) {
    return matches.map(match => <li key={match.id}><button type="button" disabled={loading} onClick={() => onSelect(match)} className="w-full rounded-md border border-border bg-card p-3 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-editorial-link disabled:opacity-50">
      {suggested && <span className="mb-1 mr-2 inline-block rounded bg-muted px-2 py-0.5 text-xs font-semibold text-editorial-link">Suggéré</span>}
      {matchPickerLabel(match)}
    </button></li>);
  }

  return <dialog ref={dialog} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }} onCancel={onClose} onClose={onClose} aria-labelledby="match-picker-title" className="fixed m-auto max-h-[85dvh] w-[min(94vw,640px)] overflow-y-auto rounded-xl border border-border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/60">
    <div className="mb-4 flex items-center justify-between gap-4"><h2 id="match-picker-title" className="text-xl font-bold">Match associé</h2><button type="button" onClick={onClose} className="rounded border border-border px-3 py-2">Fermer</button></div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Équipe<input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} maxLength={150} className="mt-1 w-full rounded border border-border bg-background px-3 py-2" placeholder="Nom d’équipe" /></label>
      <label className="text-sm">Date<input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full rounded border border-border bg-background px-3 py-2" /></label>
    </div>
    <div role="status" aria-live="polite" className="mb-3 text-sm text-muted-foreground">{loading ? "Recherche…" : error || (!suggestions.length && !results.length ? "Aucun match trouvé." : `${suggestions.length+results.length} match(s) proposé(s).`)}</div>
    {suggestions.length > 0 && <section aria-label="Suggestions"><h3 className="mb-2 font-semibold">Suggestions</h3><ul className="mb-5 space-y-2">{options(suggestions, true)}</ul></section>}
    {results.length > 0 && <section aria-label="Résultats"><h3 className="mb-2 font-semibold">Résultats</h3><ul className="space-y-2">{options(results, false)}</ul></section>}
  </dialog>;
}
