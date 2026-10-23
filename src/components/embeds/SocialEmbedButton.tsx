"use client";

import { insertMarkdown$, usePublisher } from "@mdxeditor/editor";
import { Share2 } from "@/components/icons";
import { useEffect, useRef, useState } from "react";

import {
  SOCIAL_PLATFORMS,
  normaliseSocialUrl,
  socialDirective,
  socialPlatform,
} from "@/lib/social-embeds";

/**
 * Bouton de la toolbar MDXEditor (WP15c) : choisir une plateforme, saisir
 * l'adresse de la publication, insérer `::social{platform="…" url="…"}`.
 */
export function SocialEmbedButton() {
  const insertMarkdown = usePublisher(insertMarkdown$);
  const [open, setOpen] = useState(false);
  const [platformId, setPlatformId] = useState(SOCIAL_PLATFORMS[0]?.id ?? "youtube");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur et avec Échap.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setError(null);
      }
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

  const selected = socialPlatform(platformId);

  const submit = () => {
    const normalised = normaliseSocialUrl(platformId, url);
    if (!normalised) {
      setError(
        `Adresse invalide pour ${selected?.label ?? platformId}. Exemple : ${selected?.example ?? "https://…"}`,
      );
      return;
    }
    insertMarkdown(`\n\n${socialDirective(platformId, normalised)}\n\n`);
    setUrl("");
    setError(null);
    setOpen(false);
  };

  return (
    <div className="social-embed-button" ref={wrapperRef}>
      <button
        type="button"
        className="social-embed-button-trigger"
        title="Insérer un embed social"
        aria-label="Insérer un embed social"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Share2 size={16} aria-hidden="true" />
      </button>

      {open ? (
        // Un <form> imbriqué dans le formulaire de l'article produirait du HTML
        // invalide (« <form> cannot be a descendant of <form> ») et une erreur
        // d'hydratation : le dialogue est donc un simple conteneur, et la touche
        // Entrée déclenche l'insertion depuis le champ d'adresse.
        <div
          className="social-embed-dialog"
          role="dialog"
          aria-label="Insérer un embed social"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        >
          <label className="social-embed-dialog-field">
            <span>Plateforme</span>
            <select
              value={platformId}
              onChange={(event) => {
                setPlatformId(event.target.value);
                setError(null);
              }}
            >
              {SOCIAL_PLATFORMS.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.label}
                </option>
              ))}
            </select>
          </label>

          <label className="social-embed-dialog-field">
            <span>Adresse de la publication</span>
            <input
              type="url"
              value={url}
              placeholder={selected?.example ?? "https://…"}
              onChange={(event) => {
                setUrl(event.target.value);
                setError(null);
              }}
              autoFocus
            />
          </label>

          {error ? (
            <p role="alert" className="social-embed-dialog-error">
              {error}
            </p>
          ) : null}

          <div className="social-embed-dialog-actions">
            <button type="button" className="social-embed-dialog-submit" onClick={submit}>
              Insérer
            </button>
            <button
              type="button"
              className="social-embed-dialog-cancel"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Annuler
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SocialEmbedButton;
