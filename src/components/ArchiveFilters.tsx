"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { id: string; slug: string; name: string };
const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

export function ArchiveFilters({ years, categories, themes }: { years: number[]; categories: Option[]; themes: Option[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function change(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    if (value) next.set(key, value); else next.delete(key);
    startTransition(() => router.replace(`/archives${next.size ? `?${next}` : ""}`, { scroll: false }));
  }
  const groups = [
    { key: "year", label: "Année", all: "Toutes les années", options: years.map(year => ({ value: String(year), label: String(year) })) },
    { key: "month", label: "Mois", all: "Tous les mois", options: months.map((label, index) => ({ value: String(index + 1), label })) },
    { key: "category", label: "Sport", all: "Tous les sports", options: categories.map(option => ({ value: params.get("category") === option.id ? option.id : option.slug, label: option.name })) },
    { key: "theme", label: "Thème", all: "Tous les thèmes", options: themes.map(option => ({ value: params.get("theme") === option.id ? option.id : option.slug, label: option.name })) },
    { key: "format", label: "Format", all: "Tous les formats", options: [{ value: "FLASH", label: "Flash" }, { value: "NEWS", label: "Actualité" }, { value: "ANALYSIS", label: "Analyse" }] },
  ];
  return <fieldset disabled={pending} aria-busy={pending} className="rounded-md border border-border bg-card p-5">
    <legend className="px-2 font-semibold text-foreground">Filtrer les archives</legend>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {groups.map(group => <label key={group.key} className="min-w-0 text-sm font-medium text-foreground">{group.label}
        <select name={group.key} value={params.get(group.key) ?? ""} onChange={event => change(group.key, event.target.value)} className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2">
          <option value="">{group.all}</option>
          {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>)}
    </div>
    <button type="button" className="mt-4 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted" onClick={() => startTransition(() => router.replace("/archives", { scroll: false }))}>Réinitialiser les filtres</button>
  </fieldset>;
}
