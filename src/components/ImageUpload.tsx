"use client";

import { useEffect, useRef, useState } from "react";

import { uploadImage } from "@/app/studio/articles/actions";

type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const ALLOWED_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 Mo

type ImageUploadProps = {
  /** URL existante (édition) ou chemin déjà uploadé. */
  value?: string;
  /** Appelé avec le chemin uploadé (ou "" après suppression). */
  onChange: (url: string) => void;
  /** Nom du champ caché soumis au formulaire. */
  name?: string;
};

/**
 * Sélecteur d'image de couverture : bouton de choix, prévisualisation, et
 * suppression. L'upload réel passe par la Server Action uploadImage ; le chemin
 * retourné est stocké dans un champ caché du formulaire parent.
 */
export function ImageUpload({
  value = "",
  onChange,
  name = "coverImageUrl",
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Nettoie l'URL d'aperçu créée via URL.createObjectURL.
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const displayedImage = previewUrl ?? (value || null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) {
      return;
    }

    setError(null);

    if (!ALLOWED_TYPES.has(file.type)) {
      setError("Format non autorisé. Formats acceptés : JPEG, PNG, WebP, GIF.");
      return;
    }

    if (file.size > MAX_SIZE_BYTES) {
      setError("Fichier trop volumineux. Taille maximale : 5 Mo.");
      return;
    }

    // Aperçu immédiat côté client.
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(URL.createObjectURL(file));

    setIsUploading(true);
    const formData = new FormData();
    formData.set("file", file);

    uploadImage(formData)
      .then((result: UploadResult) => {
        if (result.ok) {
          onChange(result.url);
        } else {
          setError(result.error);
          setPreviewUrl(null);
        }
      })
      .catch(() => {
        setError("Échec de l'upload. Merci de réessayer.");
        setPreviewUrl(null);
      })
      .finally(() => setIsUploading(false));
  }

  function handleRemove() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setError(null);
    onChange("");
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        Image de couverture{" "}
        <span className="font-normal text-gray-500">(optionnel)</span>
      </label>

      {/* Champ caché soumis au formulaire : le serveur lit cette valeur. */}
      <input type="hidden" name={name} value={value} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex w-full items-center justify-center overflow-hidden rounded-md border border-gray-300 bg-gray-50 sm:w-64">
          {displayedImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- aperçu client (blob) ou chemin public
            <img
              src={displayedImage}
              alt="Aperçu de l'image de couverture"
              className="max-h-48 w-full object-contain"
            />
          ) : (
            <div className="flex h-36 w-full items-center justify-center text-sm text-gray-400">
              Aucune image
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Upload en cours…" : "Choisir une image"}
          </button>

          {displayedImage ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={isUploading}
              className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
            >
              Supprimer l&apos;image
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <p className="mt-1 text-xs text-gray-500">
        JPEG, PNG, WebP ou GIF — 5 Mo maximum.
      </p>
    </div>
  );
}
