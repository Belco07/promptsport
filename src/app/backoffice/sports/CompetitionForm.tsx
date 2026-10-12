"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SPORTS } from "@/lib/sports";
import { slugify } from "@/lib/slug";

const inputClass =
  "w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-editorial-link focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-foreground";

type Props = {
  action: (prev: string | undefined, formData: FormData) => Promise<string | undefined>;
  defaultValues?: { name: string; slug: string; sport: string; country: string; season: string };
  submitLabel: string;
};

export function CompetitionForm({ action, defaultValues, submitLabel }: Props) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = { name: "", slug: "", sport: "football", country: "", season: "", ...defaultValues };

  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(initial.slug.length > 0);

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div>
        <label htmlFor="name" className={labelClass}>Nom</label>
        <input
          id="name" name="name" type="text" required minLength={2} maxLength={100}
          value={name}
          onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="slug" className={labelClass}>Slug</label>
        <input
          id="slug" name="slug" type="text" value={slug}
          onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
          placeholder="genere-depuis-le-nom"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">Généré depuis le nom si laissé vide.</p>
      </div>

      <div>
        <label htmlFor="sport" className={labelClass}>Sport</label>
        <select id="sport" name="sport" defaultValue={initial.sport} className={inputClass}>
          {SPORTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="country" className={labelClass}>Pays</label>
        <input id="country" name="country" type="text" defaultValue={initial.country} className={inputClass} />
      </div>

      <div>
        <label htmlFor="season" className={labelClass}>Saison</label>
        <input id="season" name="season" type="text" defaultValue={initial.season} placeholder="2026-2027" className={inputClass} />
      </div>

      {errorMessage ? <p role="alert" className="rounded-md border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground">{errorMessage}</p> : null}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60">
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link href="/backoffice/sports/competitions" className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted">
          Annuler
        </Link>
      </div>
    </form>
  );
}
