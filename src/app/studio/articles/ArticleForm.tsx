"use client";

import { VisualStudioButton } from "@/components/visual-studio/VisualStudioButton";

import Link from "next/link";
import dynamic from "next/dynamic";
import type { ArticleFormat } from "@/components/FormatBadge";
import { useActionState, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getArticleMatch, type MatchPickerOption } from "./actions";
import { MatchPickerModal, matchPickerLabel } from "@/components/studio/MatchPickerModal";

import { ImageUpload } from "@/components/ImageUpload";
import { ThemeSelector, type ThemeOption } from "@/components/studio/ThemeSelector";
import {
  ARTICLE_STATUSES,
  ARTICLE_STATUS_LABELS,
  type ArticleStatus,
} from "@/lib/articleStatus";
import { slugify } from "@/lib/slug";

export type ArticleFormValues = {
  format: ArticleFormat;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  coverImageUrl: string;
  /** Crédit de la photo de couverture (ex. « L'Équipe »). */
  coverImageCredit: string;
  categoryId: string;
  status: ArticleStatus;
  isPremium: boolean;
  /** Thèmes associés (WP16b) : identifiants `Theme`. */
  themeIds: string[];
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
  /** Thèmes proposés dans le sélecteur (WP16b). */
  themes?: ThemeOption[];
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
  "w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-editorial-link focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-foreground";

/** Accroche locale : premières phrases du texte, sans balisage Markdown. */
function summarizeContent(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ").trim();
  if (text.length <= 300) return text;
  const short = text.slice(0, 300);
  const sentence = short.match(/^([\s\S]*[.!?])(?:\s|$)/)?.[1];
  return sentence && sentence.length >= 120
    ? sentence
    : `${short.replace(/\s+\S*$/, "").trimEnd()}…`;
}

const EMPTY: ArticleFormValues = {
  format: "NEWS",
  title: "",
  slug: "",
  content: "",
  excerpt: "",
  coverImageUrl: "",
  coverImageCredit: "",
  categoryId: "",
  status: "DRAFT",
  isPremium: false,
  themeIds: [],
};

/**
 * Formulaire partagé par la création et l'édition.
 * Le slug suit le titre tant que l'utilisateur ne l'a pas modifié lui-même.
 */
const RichTextEditor = dynamic(() => import("@/components/RichTextEditor"), {
  ssr: false,
  loading: () => <div role="status" className="min-h-80 rounded-md border border-border bg-muted p-5 text-muted-foreground">Chargement de l’éditeur…</div>,
});

export function ArticleForm({
  action,
  categories,
  themes = [],
  defaultValues,
  submitLabel,
  allowedStatuses = [...ARTICLE_STATUSES],
  canSetPremium = false,
}: ArticleFormProps) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = { ...EMPTY, ...defaultValues };

  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [excerpt, setExcerpt] = useState(initial.excerpt);
  const [manualExcerpt, setManualExcerpt] = useState(Boolean(initial.excerpt.trim()));
  const displayedExcerpt = manualExcerpt ? excerpt : summarizeContent(content);
  const [format, setFormat] = useState<ArticleFormat>(initial.format);
  const [slug, setSlug] = useState(initial.slug);
  const [slugEdited, setSlugEdited] = useState(initial.slug.length > 0);
  const [coverImageUrl, setCoverImageUrl] = useState(initial.coverImageUrl);
  // WP16b : thèmes retenus, sérialisés dans un champ caché pour la Server Action.
  const [themeIds, setThemeIds] = useState<string[]>(initial.themeIds);
  const params = useParams<{ id?: string }>();
  const articleId = params?.id;
  const [match, setMatch] = useState<MatchPickerOption | null>(null);
  const [matchLoaded, setMatchLoaded] = useState(!articleId);
  const [matchError, setMatchError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (!articleId) return;
    let cancelled = false;
    getArticleMatch(articleId).then(selected => {
      if (!cancelled) { setMatch(selected); setMatchLoaded(true); }
    }).catch(() => { if (!cancelled) setMatchError(true); });
    return () => { cancelled = true; };
  }, [articleId]);

  return (
    <form action={formAction} className="max-w-2xl space-y-5">
      <section aria-labelledby="associated-match-label" className="rounded-md border border-border bg-card p-4">
        <h2 id="associated-match-label" className="mb-2 text-sm font-semibold text-foreground">Match associé</h2>
        <p className="mb-3 text-sm text-muted-foreground">{match ? matchPickerLabel(match) : matchLoaded ? "Aucun match associé." : matchError ? "Association indisponible. La valeur existante sera conservée." : "Chargement de l’association…"}</p>
        {matchLoaded && <input type="hidden" name="matchId" value={match?.id ?? ""} />}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!matchLoaded} onClick={() => setPickerOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50">{match ? "Changer de match" : "Choisir un match"}</button>
          {match && <button type="button" onClick={() => setMatch(null)} className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">Retirer l’association</button>}
        </div>
        {pickerOpen && <MatchPickerModal articleId={articleId} title={title} content={content} onClose={() => setPickerOpen(false)} onSelect={selected => { setMatch(selected); setPickerOpen(false); }} />}
      </section>
      <div>
        <label htmlFor="format" className={labelClass}>Format</label>
        <select id="format" name="format" value={format} onChange={(event) => setFormat(event.target.value as ArticleFormat)} className={inputClass}>
          <option value="FLASH">Flash</option>
          <option value="NEWS">Actualité</option>
          <option value="ANALYSIS">Analyse</option>
        </select>
      </div>
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
        <p className="mt-1 text-xs text-muted-foreground">
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
        <div id="themes-label" className={labelClass}>
          Thèmes <span className="font-normal text-muted-foreground">(optionnel)</span>
        </div>
        <div role="group" aria-labelledby="themes-label">
          <ThemeSelector themes={themes} value={themeIds} onChange={setThemeIds} />
        </div>
        <input type="hidden" name="themeIds" value={JSON.stringify(themeIds)} />
        <p className="mt-1 text-xs text-muted-foreground">
          Thèmes éditoriaux transversaux (Mercato, Tactique…), indépendants de la catégorie sportive.
        </p>
      </div>

      <div>
        <div id="content-label" className={labelClass}>Contenu</div>
        <div role="group" aria-labelledby="content-label">
          <RichTextEditor value={content} onChange={setContent} />
        </div>
        <input type="hidden" name="content" value={content} />
      </div>

      <div>
        <label htmlFor="excerpt" className={labelClass}>
          Extrait <span className="font-normal text-muted-foreground">(optionnel)</span>
        </label>
        <textarea
          id="excerpt"
          name="excerpt"
          rows={3}
          value={displayedExcerpt}
          onChange={(event) => { setExcerpt(event.target.value); setManualExcerpt(true); }}
          className={inputClass}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {manualExcerpt ? "Résumé personnalisé : vos modifications sont conservées." : "Résumé automatique à partir des premières phrases, mis à jour pendant la rédaction."}
          </p>
          {manualExcerpt && <button type="button" className="rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted" onClick={() => setManualExcerpt(false)}>Générer depuis le contenu</button>}
        </div>
      </div>

      <div>
        <ImageUpload
          value={coverImageUrl}
          onChange={setCoverImageUrl}
          name="coverImageUrl"
        />
        <label htmlFor="coverImageCredit" className={`${labelClass} mt-3`}>
          Crédit photo <span className="font-normal text-muted-foreground">(obligatoire si la photo vient d&apos;une source)</span>
        </label>
        <input
          id="coverImageCredit"
          name="coverImageCredit"
          type="text"
          maxLength={160}
          defaultValue={initial.coverImageCredit}
          placeholder="Ex. L'Équipe"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Affiché sous la photo sous la forme « Photo : … ». Utilisez le nom du
          média ou du photographe, selon la licence.
        </p>
        <div className="mt-3"><VisualStudioButton onImage={setCoverImageUrl} label="Créer une image de couverture avec le Visual Studio" /></div>
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
        <p className="mt-1 text-xs text-muted-foreground">
          Seuls les articles « Publié » sont visibles sur le site.
          {allowedStatuses.length === 1 && initial.status === "PUBLISHED"
            ? " Vous pouvez corriger le contenu. L’article reste publié ; seuls les éditeurs et administrateurs peuvent changer son statut."
            : allowedStatuses.length < ARTICLE_STATUSES.length
            ? " Votre rôle ne permet pas de publier ni d'archiver : passez l'article « En revue » pour le confier à un éditeur."
            : ""}
        </p>
      </div>

      {canSetPremium ? (
        <div className="rounded-md border border-border bg-muted p-4">
          <label
            htmlFor="isPremium"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <input
              id="isPremium"
              name="isPremium"
              type="checkbox"
              defaultChecked={initial.isPremium}
              className="h-4 w-4 rounded border-border text-editorial-link focus:ring-blue-600"
            />
            Article premium
          </label>
          <p className="mt-1 pl-6 text-xs text-muted-foreground">
            Réservé aux abonnés : le public ne verra que le début de l&apos;article.
          </p>
        </div>
      ) : (
        // Le réglage reste visible même sans le droit de le changer : l'auteur
        // doit savoir que son article est réservé aux abonnés. Aucun champ n'est
        // envoyé, la valeur en base est conservée par la Server Action.
        <p className="rounded-md border border-border bg-muted p-4 text-sm text-foreground">
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
          className="rounded-md border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link
          href="/studio/articles"
          className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
