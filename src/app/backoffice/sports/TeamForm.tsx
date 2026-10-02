"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { SPORTS } from "@/lib/sports";
import { slugify } from "@/lib/slug";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

type Props = {
  action: (prev: string | undefined, formData: FormData) => Promise<string | undefined>;
  defaultValues?: { name: string; slug: string; shortName: string; sport: string; country: string; logoUrl: string };
  submitLabel: string;
};

export function TeamForm({ action, defaultValues, submitLabel }: Props) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = { name: "", slug: "", shortName: "", sport: "football", country: "", logoUrl: "", ...defaultValues };

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
          className={inputClass}
        />
        <p className="mt-1 text-xs text-gray-500">Généré depuis le nom si laissé vide.</p>
      </div>

      <div>
        <label htmlFor="shortName" className={labelClass}>Abréviation</label>
        <input id="shortName" name="shortName" type="text" defaultValue={initial.shortName} placeholder="PSG" className={inputClass} />
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
        <label htmlFor="logoUrl" className={labelClass}>Logo (URL)</label>
        <input id="logoUrl" name="logoUrl" type="url" defaultValue={initial.logoUrl} placeholder="https://…" className={inputClass} />
      </div>

      {errorMessage ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60">
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link href="/backoffice/sports/teams" className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100">
          Annuler
        </Link>
      </div>
    </form>
  );
}
