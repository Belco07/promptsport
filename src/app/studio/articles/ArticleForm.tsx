"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ImageUpload } from "@/components/ImageUpload";
import {
  ARTICLE_STATUSES,
  ARTICLE_STATUS_LABELS,
  type ArticleStatus,
} from "@/lib/articleStatus";
import { slugify } from "@/lib/slug";

export type ArticleFormValues = {
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  coverImageUrl: string;
  categoryId: string;
  status: ArticleStatus;
  isPremium: boolean;
};

export type CategoryOption = {
  id: string;
  name: string;
};

type ArticleFormProps = {
  action: (
    previousState: string | undefined,
    formData: FormData,
  ) => Promise<string | undefined>;
  categories: CategoryOption[];
  /** Valeurs initiales (création : formulaire vide). */
  defaultValues?: Partial<ArticleFormValues>;
  submitLabel: string;
  /**
   * Statuts proposés. Calculés par la page selon le rôle et l'article (WP11) :
   * un journaliste ne propose que « Brouillon » et « En revue ». La Server Action
   * applique les mêmes règles, ceci n'est que le reflet dans le formulaire.
   */
  allowedStatuses?: ArticleStatus[];
  /**
   * Le rôle peut-il décider du caractère premium (WP11) ? Sinon la case n'est
   * pas rendue : la Server Action conserve alors la valeur en base, pour qu'un
   * enregistrement de brouillon ne retire pas le paywall par accident.
   */
  canSetPremium?: boolean;
};

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

const EMPTY: ArticleFormValues = {
  title: "",
  slug: "",
  content: "",
  excerpt: "",
  coverImageUrl: "",
  categoryId: "",
  status: "DRAFT",
  isPremium: false,
};

/**
 * Formulaire partagé par la création et l'édition.
 * Le slug suit le titre tant que l'utilisateur ne l'a pas modifié lui-même.
 */
export function ArticleForm({
  action,
  categories,
  defaultValues,
  submitLabel,
  allowedStatuses = [...ARTICLE_STATUSES],
  canSetPremium = false,
}: ArticleFormProps) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = { ...EMPTY, ...defaultValues };

  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(initial.slug.length > 0);
  const [coverImageUrl, setCoverImageUrl] = useState(initial.coverImageUrl);

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <div>
        <label htmlFor="title" className={labelClass}>
          Titre
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          value={title}
          onChange={(event) => {
            const nextTitle = event.target.value;
            setTitle(nextTitle);
            if (!slugEdited) {
              setSlug(slugify(nextTitle));
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
          placeholder="genere-automatiquement-depuis-le-titre"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-gray-500">
          Généré depuis le titre si laissé vide. Utilisé dans l&apos;URL publique.
        </p>
      </div>

      <div>
        <label htmlFor="categoryId" className={labelClass}>
          Catégorie
        </label>
        <select
          id="categoryId"
          name="categoryId"
          required
          defaultValue={initial.categoryId}
          className={inputClass}
        >
          <option value="">— Choisir une catégorie —</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="content" className={labelClass}>
          Contenu (Markdown)
        </label>
        <textarea
          id="content"
          name="content"
          rows={12}
          required
          defaultValue={initial.content}
          className={`${inputClass} font-mono`}
        />
      </div>

      <div>
        <label htmlFor="excerpt" className={labelClass}>
          Extrait <span className="font-normal text-gray-500">(optionnel)</span>
        </label>
        <textarea
          id="excerpt"
          name="excerpt"
          rows={3}
          defaultValue={initial.excerpt}
          className={inputClass}
        />
      </div>

      <div>
        <ImageUpload
          value={coverImageUrl}
          onChange={setCoverImageUrl}
          name="coverImageUrl"
        />
      </div>

      <div>
        <label htmlFor="status" className={labelClass}>
          Statut
        </label>
        <select
          id="status"
          name="status"
          defaultValue={initial.status}
          className={inputClass}
        >
          {allowedStatuses.map((status) => (
            <option key={status} value={status}>
              {ARTICLE_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Seuls les articles « Publié » sont visibles sur le site.
          {allowedStatuses.length < ARTICLE_STATUSES.length
            ? " Votre rôle ne permet pas de publier ni d'archiver : passez l'article « En revue » pour le confier à un éditeur."
            : ""}
        </p>
      </div>

      {canSetPremium ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
          <label
            htmlFor="isPremium"
            className="flex items-center gap-2 text-sm font-medium text-gray-800"
          >
            <input
              id="isPremium"
              name="isPremium"
              type="checkbox"
              defaultChecked={initial.isPremium}
              className="h-4 w-4 rounded border-gray-300 text-blue-700 focus:ring-blue-600"
            />
            Article premium
          </label>
          <p className="mt-1 pl-6 text-xs text-gray-500">
            Réservé aux abonnés : le public ne verra que le début de l&apos;article.
          </p>
        </div>
      ) : (
        // Le réglage reste visible même sans le droit de le changer : l'auteur
        // doit savoir que son article est réservé aux abonnés. Aucun champ n'est
        // envoyé, la valeur en base est conservée par la Server Action.
        <p className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          {initial.isPremium ? (
            <>
              <span className="font-medium">Article premium</span> — réservé aux abonnés. Seuls un
              éditeur ou un administrateur peuvent modifier ce réglage.
            </>
          ) : (
            <>
              Le passage en <span className="font-medium">article premium</span> (réservé aux
              abonnés) est décidé par un éditeur ou un administrateur, au moment de publier.
            </>
          )}
        </p>
      )}

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
          href="/studio/articles"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
