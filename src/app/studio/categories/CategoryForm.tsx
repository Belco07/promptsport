"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { slugify } from "@/lib/slug";

export type CategoryFormValues = {
  name: string;
  slug: string;
};

type CategoryFormProps = {
  action: (
    previousState: string | undefined,
    formData: FormData,
  ) => Promise<string | undefined>;
  defaultValues?: Partial<CategoryFormValues>;
  submitLabel: string;
};

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

/**
 * Formulaire de catégorie (création et édition).
 * Le slug suit le nom tant que l'utilisateur ne l'a pas modifié.
 */
export function CategoryForm({
  action,
  defaultValues,
  submitLabel,
}: CategoryFormProps) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = { name: "", slug: "", ...defaultValues };

  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(initial.slug.length > 0);

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div>
        <label htmlFor="name" className={labelClass}>
          Nom
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={name}
          onChange={(event) => {
            const next = event.target.value;
            setName(next);
            if (!slugEdited) {
              setSlug(slugify(next));
            }
          }}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="slug" className={labelClass}>
          Slug
        </label>
        <input
          id="slug"
          name="slug"
          type="text"
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugEdited(true);
          }}
          placeholder="genere-depuis-le-nom"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-gray-500">
          Généré depuis le nom si laissé vide.
        </p>
      </div>

      {errorMessage ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link
          href="/studio/categories"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
