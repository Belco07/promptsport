"use client";
import { CalendarInput } from "@/components/CalendarInput";


import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { id: string; slug: string; name: string };
export function SearchFilters({ categories, themes }: { categories: Option[]; themes: Option[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`/recherche${next.size ? `?${next}` : ""}`, { scroll: false }));
  }
  const inputClass = "mt-2 w-full min-w-0 rounded-md border border-border bg-card px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2";
  return <fieldset aria-busy={pending} disabled={pending} className="space-y-5 border-y border-border py-5">
    <legend className="px-2 text-sm font-semibold text-foreground">Affiner la recherche</legend>
    <div role="group" aria-label="Format de l’article" className="flex flex-wrap gap-2">
      {[["", "Tous"], ["FLASH", "Flash"], ["NEWS", "Actu"], ["ANALYSIS", "Analyse"]].map(([value, label]) => {
        const selected = (params.get("format") ?? "") === value;
        return <button type="button" key={label} aria-pressed={selected} onClick={() => update("format", value)} className={`rounded-md border px-4 py-2 text-sm font-semibold ${selected ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:bg-muted"}`}>{label}</button>;
      })}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="min-w-0 text-sm font-medium text-foreground">Sport
        <select name="category" value={params.get("category") ?? ""} onChange={(event) => update("category", event.target.value)} className={inputClass}>
          <option value="">Tous les sports</option>
          {categories.map(option => <option key={option.id} value={params.get("category") === option.id ? option.id : option.slug}>{option.name}</option>)}
        </select>
      </label>
      <label className="min-w-0 text-sm font-medium text-foreground">Thème
        <select name="theme" value={params.get("theme") ?? ""} onChange={(event) => update("theme", event.target.value)} className={inputClass}>
          <option value="">Tous les thèmes</option>
          {themes.map(option => <option key={option.id} value={params.get("theme") === option.id ? option.id : option.slug}>{option.name}</option>)}
        </select>
      </label>
      <div className="min-w-0 text-sm font-medium text-foreground">Depuis
        <CalendarInput name="from" label="Depuis" value={params.get("from") ?? ""} onValueChange={(value) => update("from", value)} className={inputClass} />
      </div>
      <div className="min-w-0 text-sm font-medium text-foreground">Jusqu’à
        <CalendarInput name="to" label="Jusqu’à" value={params.get("to") ?? ""} onValueChange={(value) => update("to", value)} className={inputClass} />
      </div>
    </div>
  </fieldset>;
}
