"use client";

import { uploadImage } from "@/app/studio/articles/actions";

/** Only token metadata crosses the function; image bytes go straight to Blob. */
export async function uploadStudioImage(form: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  try {
    const file = form.get("file");
    if (!(file instanceof File) || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return { ok: false, error: "Image JPEG, PNG, WebP ou GIF requise." };
    if (!file.size || file.size > 5 * 1024 * 1024) return { ok: false, error: "L’image doit peser entre 1 octet et 5 Mo." };
    const response = await fetch("/api/studio/images", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok) return { ok: false, error: config.error ?? "Stockage indisponible." };
    if (!config.direct) return uploadImage(form);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[file.type];
    const { upload } = await import("@vercel/blob/client");
    const blob = await upload(`uploads/${crypto.randomUUID()}.${extension}`, file, {
      access: "public", handleUploadUrl: "/api/studio/images", contentType: file.type,
    });
    return { ok: true, url: blob.url };
  } catch {
    return { ok: false, error: "L’envoi de l’image a échoué. Vérifiez votre connexion, votre session et le stockage Blob." };
  }
}
