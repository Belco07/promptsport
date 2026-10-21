"use server";
import { auth } from "@/lib/auth";
import { canAccessStudio } from "@/lib/roles";
import { uploadImage } from "@/app/studio/articles/actions";

export async function saveVisualImage(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) return { ok: false as const, error: "Connectez-vous au Studio pour enregistrer une image." };
  if (process.env.NODE_ENV === "production" && !process.env.BLOB_READ_WRITE_TOKEN) return { ok: false as const, error: "Le stockage Vercel Blob n’est pas configuré." };
  const file = formData.get("file");
  if (!(file instanceof File) || !["image/png", "image/webp"].includes(file.type)) return { ok: false as const, error: "Export PNG ou WebP requis." };
  return uploadImage(formData);
}
