"use client";

import { insertMarkdown$, usePublisher } from "@mdxeditor/editor";
import { ImagePlus } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

import { uploadStudioImage as uploadImage } from "@/lib/upload-studio-image";

/**
 * Bouton « Insérer une image » de la toolbar MDXEditor (WP15b).
 *
 * L'envoi du fichier réutilise la Server Action `uploadImage` (WP12d) : aucune
 * logique d'upload n'est dupliquée ici. La validation côté navigateur reprend
 * les mêmes règles que l'action (type MIME, 5 Mo) pour un retour immédiat ;
 * le serveur revalide de toute façon.
 *
 * Une fois l'URL obtenue, le Markdown de l'image est inséré à la position du
 * curseur :
 *
 *   ![légende](URL "légende")   — avec légende
 *   ![](URL)                    — sans légende
 *
 * La légende est répétée en `title` : le rendu public
 * (`src/app/article/[slug]/page.tsx`) affiche la légende visible depuis le
 * `title` de l'image, l'attribut `alt` restant disponible pour l'accessibilité.
 */

/** Règles alignées sur `uploadImage` (src/app/studio/articles/actions.ts). */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp,image/gif";

/** Markdown de l'image, avec échappement des caractères significatifs. */
export function imageMarkdown(url: string, caption: string): string {
  const clean = caption.replace(/\s+/g, " ").trim();
  if (!clean) return `![](${url})`;
  const alt = clean.replace(/([\\[\]])/g, "\\$1");
  const title = clean.replace(/([\\"])/g, "\\$1");
  return `![${alt}](${url} "${title}")`;
}

/** Taille lisible d'un fichier, pour le récapitulatif du dialogue. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
}

export function ImageUploadButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fermeture au clic extérieur et avec Échap (jamais pendant l'envoi).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isUploading) setOpen(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (isUploading) return;
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
  }, [open, isUploading]);

  function reset() {
    setFile(null);
    setCaption("");
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (isUploading) return;
    setOpen(false);
    reset();
  }

  function selectFile(selected: File | null) {
    setError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!ALLOWED_TYPES.has(selected.type)) {
      setError("Format non autorisé. Formats acceptés : JPEG, PNG, WebP, GIF.");
      setFile(null);
      return;
    }
    if (selected.size > MAX_SIZE_BYTES) {
      setError("Fichier trop volumineux. Taille maximale : 5 Mo.");
      setFile(null);
      return;
    }
    if (selected.size === 0) {
      setError("Fichier vide.");
      setFile(null);
      return;
    }
    setFile(selected);
  }

  async function submit() {
    if (!file || isUploading) return;
    setError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadImage(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      insertMarkdown(`\n\n${imageMarkdown(result.url, caption)}\n\n`);
      setOpen(false);
      reset();
    } catch {
      setError("Échec de l’upload. Merci de réessayer.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="image-upload-button" ref={wrapperRef}>
      <button
        type="button"
        className="image-upload-button-trigger"
        title="Insérer une image"
        aria-label="Insérer une image"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ImagePlus size={16} aria-hidden="true" />
      </button>

      {open ? (
        // Conteneur simple, jamais un <form> : l'éditeur est rendu à l'intérieur
        // du formulaire de l'article, un <form> imbriqué produirait du HTML
        // invalide et une erreur d'hydratation.
        <div
          className="image-upload-dialog"
          role="dialog"
          aria-label="Insérer une image"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !isUploading) {
              event.preventDefault();
              void submit();
            }
          }}
        >
          <label className="image-upload-dialog-field">
            <span>Fichier image</span>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              disabled={isUploading}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                // Permet de re-sélectionner le même fichier après une erreur.
                event.target.value = "";
                selectFile(selected);
              }}
            />
          </label>

          {file ? (
            <p className="image-upload-dialog-file">
              {file.name} — {formatSize(file.size)}
            </p>
          ) : (
            <p className="image-upload-dialog-hint">JPEG, PNG, WebP ou GIF — 5 Mo maximum.</p>
          )}

          <label className="image-upload-dialog-field">
            <span>Légende (optionnel)</span>
            <input
              type="text"
              value={caption}
              maxLength={200}
              placeholder="Décrivez l’image"
              disabled={isUploading}
              onChange={(event) => setCaption(event.target.value)}
            />
          </label>

          {error ? (
            <p role="alert" className="image-upload-dialog-error">
              {error}
            </p>
          ) : null}

          <div className="image-upload-dialog-actions">
            <button
              type="button"
              className="image-upload-dialog-submit"
              onClick={() => void submit()}
              disabled={!file || isUploading}
            >
              {isUploading ? "Upload en cours…" : "Uploader"}
            </button>
            <button
              type="button"
              className="image-upload-dialog-cancel"
              onClick={close}
              disabled={isUploading}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ImageUploadButton;
