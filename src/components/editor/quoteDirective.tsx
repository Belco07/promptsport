"use client";

import {
  insertMarkdown$,
  useLexicalNodeRemove,
  usePublisher,
  type DirectiveDescriptor,
  type DirectiveEditorProps,
} from "@mdxeditor/editor";
import type { Directives } from "mdast-util-directive";
import { Quote } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

/**
 * Citations enrichies (WP15d) : bouton « Insérer une citation » de la toolbar et
 * rendu de la directive dans l'éditeur.
 *
 * La directive produite est celle du brief :
 *
 *   ::quote{#texte auteur="nom"}     — texte d'un seul mot
 *   ::quote[texte de la citation]{auteur="nom"}  — phrase entière
 *
 * `#texte` est un identifiant pour `remark-directive` : au-delà du premier
 * espace, la suite du texte serait perdue (les mots deviendraient des attributs
 * vides). L'éditeur choisit donc la forme entre crochets dès que la citation
 * contient un espace — les deux formes sont lues par `remark-quotes`.
 */

/** Directive Markdown insérée, avec échappement de l'auteur. */
export function quoteDirectiveMarkdown(text: string, author: string): string {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const cleanAuthor = author.replace(/\s+/g, " ").replace(/"/g, "’").trim();
  const attributes = cleanAuthor ? `auteur="${cleanAuthor}"` : "";

  const singleWord = cleanText.length > 0 && !/[\s#[\]{}"]/.test(cleanText);
  if (singleWord) {
    return `::quote{#${cleanText}${attributes ? ` ${attributes}` : ""}}`;
  }
  return `::quote[${cleanText}]${attributes ? `{${attributes}}` : ""}`;
}

/** Texte de la citation portée par un nœud de directive. */
function directiveText(mdastNode: Directives): string {
  const children = (mdastNode as { children?: Array<{ type: string; value?: string }> }).children ?? [];
  const label = children
    .map((child) => (typeof child.value === "string" ? child.value : ""))
    .join("")
    .trim();
  if (label) return label;
  const identifier = mdastNode.attributes?.id;
  return typeof identifier === "string" ? identifier : "";
}

/** Auteur déclaré sur la directive. */
function directiveAuthor(mdastNode: Directives): string {
  const raw = mdastNode.attributes?.auteur ?? mdastNode.attributes?.author;
  return typeof raw === "string" ? raw : "";
}

/**
 * Rendu de la directive dans l'éditeur : la citation reste visible et
 * supprimable ; elle ne se modifie pas sur place (on la supprime et on la
 * réinsère), ce qui évite toute réécriture hasardeuse du Markdown.
 */
function QuoteDirectiveEditor({ mdastNode }: DirectiveEditorProps<Directives>) {
  const removeNode = useLexicalNodeRemove();
  const text = directiveText(mdastNode);
  const author = directiveAuthor(mdastNode);

  return (
    <div className="quote-directive" contentEditable={false}>
      <div className="quote-directive-head">
        <span className="quote-directive-badge">Citation</span>
        <button
          type="button"
          className="quote-directive-remove"
          onClick={() => removeNode()}
          title="Supprimer la citation"
        >
          Supprimer
        </button>
      </div>
      <blockquote className="quote-directive-text">{text}</blockquote>
      {author ? <p className="quote-directive-author">{author}</p> : null}
    </div>
  );
}

/** Descripteur enregistré auprès de `directivesPlugin`. */
export const quoteDescriptor: DirectiveDescriptor<Directives> = {
  name: "Citation",
  attributes: ["auteur"],
  // La forme `[texte]` porte du contenu : le descripteur le déclare.
  hasChildren: true,
  type: "leafDirective",
  testNode: (node) => node.type === "leafDirective" && node.name === "quote",
  Editor: QuoteDirectiveEditor,
};

/** Bouton de toolbar : texte de la citation + auteur optionnel. */
export function QuoteButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur et avec Échap.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setText("");
    setAuthor("");
    setError(null);
  }

  function submit() {
    if (!text.trim()) {
      setError("Le texte de la citation est obligatoire.");
      return;
    }
    insertMarkdown(`\n\n${quoteDirectiveMarkdown(text, author)}\n\n`);
    close();
  }

  return (
    <div className="quote-button" ref={wrapperRef}>
      <button
        type="button"
        className="quote-button-trigger"
        title="Insérer une citation"
        aria-label="Insérer une citation"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Quote size={16} aria-hidden="true" />
      </button>

      {open ? (
        // Conteneur simple : l'éditeur vit dans le formulaire de l'article, un
        // <form> imbriqué produirait du HTML invalide.
        <div
          className="quote-dialog"
          role="dialog"
          aria-label="Insérer une citation"
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        >
          <label className="quote-dialog-field">
            <span>Texte de la citation</span>
            <textarea
              value={text}
              rows={3}
              maxLength={500}
              placeholder="« Le texte à citer »"
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
              autoFocus
            />
          </label>

          <label className="quote-dialog-field">
            <span>Auteur (optionnel)</span>
            <input
              type="text"
              value={author}
              maxLength={120}
              placeholder="Nom, fonction…"
              onChange={(event) => setAuthor(event.target.value)}
            />
          </label>

          {error ? (
            <p role="alert" className="quote-dialog-error">
              {error}
            </p>
          ) : null}

          <div className="quote-dialog-actions">
            <button type="button" className="quote-dialog-submit" onClick={submit}>
              Insérer
            </button>
            <button type="button" className="quote-dialog-cancel" onClick={close}>
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default QuoteButton;
