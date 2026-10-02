"use server";

import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSlug } from "@/lib/slug";
import { isArticleStatus, type ArticleStatus } from "@/lib/articleStatus";
import {
  canDeleteArticle,
  canEditArticle,
  canPublish,
  canSetPremium,
  canTransitionArticle,
} from "@/lib/roles";

/**
 * Server Actions du CRUD articles (WP2c).
 *
 * Toutes les mutations passent par ici : aucune route handler API.
 * Validation faite côté serveur, y compris l'unicité du slug (contrainte
 * de base de données) et l'auteur, qui provient toujours de la session.
 */

/** Code Prisma d'une violation de contrainte d'unicité. */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

/**
 * Invalide les pages publiques prérendues qui dépendent des articles publiés.
 *
 * L'accueil est prérendu avec `revalidate = 60` (WP8c), le sitemap avec 1 h et
 * le flux RSS avec 15 min. Sans cet appel, une publication, une dépublication ou
 * un changement de diffusion n'apparaîtrait qu'à l'expiration de la fenêtre — et
 * ISR servirait une première fois l'ancienne version. Les pages d'article, de
 * rubrique et d'auteur, elles, sont rendues à la demande : inutile de les
 * invalider.
 *
 * Le passage par le sélecteur de statut le faisait déjà ; les créations,
 * modifications et suppressions d'articles publiés ne le faisaient pas.
 */
function revalidatePublicSurfaces(): void {
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  revalidatePath("/rss.xml");
}

/** Vrai si l'erreur est une violation d'unicité Prisma (slug déjà pris). */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/** Lecture d'un champ texte du FormData. */
function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lecture d'une case à cocher : absente du FormData quand elle est décochée.
 * Les valeurs « false »/« off »/vide sont traitées comme décochées au cas où le
 * formulaire serait soumis par un autre client.
 */
function readCheckbox(formData: FormData, field: string): boolean {
  const value = formData.get(field);
  if (value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "false" && normalized !== "off" && normalized !== "0";
}

type ArticleInput = {
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  categoryId: string;
  status: ArticleStatus;
  isPremium: boolean;
};

type ValidationResult =
  | { ok: true; data: ArticleInput }
  | { ok: false; error: string };

async function validate(
  formData: FormData,
  { requireCategory = true }: { requireCategory?: boolean } = {},
): Promise<ValidationResult> {
  const title = readText(formData, "title");
  const content = readText(formData, "content");
  const categoryId = readText(formData, "categoryId");
  const excerpt = readText(formData, "excerpt");
  const coverImageUrl = readText(formData, "coverImageUrl");
  const rawStatus = readText(formData, "status");

  if (!title) {
    return { ok: false, error: "Le titre est obligatoire." };
  }

  if (!content) {
    return { ok: false, error: "Le contenu est obligatoire." };
  }

  if (requireCategory && !categoryId) {
    return { ok: false, error: "La catégorie est obligatoire." };
  }

  if (!isArticleStatus(rawStatus)) {
    return { ok: false, error: "Statut invalide." };
  }

  const slug = resolveSlug(readText(formData, "slug"), title);
  if (!slug) {
    return {
      ok: false,
      error:
        "Impossible de générer un slug à partir du titre : saisissez un slug manuellement.",
    };
  }

  return {
    ok: true,
    data: {
      title,
      slug,
      content,
      excerpt: excerpt || null,
      coverImageUrl: coverImageUrl || null,
      categoryId,
      status: rawStatus,
      isPremium: readCheckbox(formData, "isPremium"),
    },
  };
}

/**
 * Création d'un article. L'auteur est celui de la session : le formulaire ne
 * propose pas de sélection d'auteur.
 */
export async function createArticle(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const result = await validate(formData);
  if (!result.ok) {
    return result.error;
  }

  // Un journaliste ne peut pas créer un article déjà publié ou archivé : la
  // règle de publication ne doit pas être contournable par le formulaire.
  if (!canPublish(session.user.role) && (result.data.status === "PUBLISHED" || result.data.status === "ARCHIVED")) {
    return "Seuls les éditeurs peuvent publier ou archiver un article.";
  }

  try {
    await prisma.article.create({
      data: {
        ...result.data,
        // Le caractère premium est décidé par un ADMIN ou un EDITOR (WP11) :
        // un journaliste crée toujours un article en accès libre, même s'il
        // forge le champ dans sa requête.
        isPremium: canSetPremium(session.user.role) ? result.data.isPremium : false,
        authorId: session.user.id,
        publishedAt: result.data.status === "PUBLISHED" ? new Date() : null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return `Le slug « ${result.data.slug} » est déjà utilisé par un autre article.`;
    }
    throw error;
  }

  revalidatePath("/studio/articles");
  if (result.data.status === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
  redirect("/studio/articles");
}

/** Mise à jour d'un article existant. */
export async function updateArticle(
  id: string,
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) {
    return "Cet article n'existe plus.";
  }

  // Droits : un journaliste ne modifie que ses propres articles non publiés ;
  // un article publié n'est plus modifiable par son auteur (WP11).
  const viewer = { id: session.user.id, role: session.user.role };
  if (!canEditArticle(viewer, existing)) {
    return "Vous n'avez pas le droit de modifier cet article.";
  }

  const result = await validate(formData);
  if (!result.ok) {
    return result.error;
  }

  // Le statut envoyé par le formulaire doit lui aussi respecter le workflow,
  // sinon l'édition permettrait de publier sans y être autorisé.
  if (result.data.status !== existing.status && !canTransitionArticle(viewer, existing, result.data.status)) {
    return "Changement de statut non autorisé.";
  }

  try {
    await prisma.article.update({
      where: { id },
      data: {
        ...result.data,
        // Le caractère premium ne suit pas le droit d'édition : un journaliste
        // qui enregistre son brouillon ne peut ni l'activer ni l'effacer. Sa
        // valeur en base est donc conservée telle quelle (WP11) — sinon un
        // simple enregistrement retirerait le paywall sans que personne ne le
        // demande.
        isPremium: canSetPremium(session.user.role) ? result.data.isPremium : existing.isPremium,
        // On horodate la première publication, sans l'écraser ensuite.
        publishedAt:
          result.data.status === "PUBLISHED"
            ? (existing.publishedAt ?? new Date())
            : null,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return `Le slug « ${result.data.slug} » est déjà utilisé par un autre article.`;
    }
    throw error;
  }

  revalidatePath("/studio/articles");
  // Un article publié avant ou après cette modification change l'accueil (titre,
  // extrait, diffusion premium), le sitemap et le flux RSS.
  if (existing.status === "PUBLISHED" || result.data.status === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
  redirect("/studio/articles");
}

/** Change le statut d'un article (workflow éditorial). */
export async function updateArticleStatus(
  articleId: string,
  newStatus: ArticleStatus,
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  if (!isArticleStatus(newStatus)) {
    return;
  }

  const existing = await prisma.article.findUnique({ where: { id: articleId } });
  if (!existing) {
    return;
  }

  // Règles du workflow (WP11) :
  //  - l'auteur circule entre brouillon et relecture sur ses articles non publiés ;
  //  - seuls ADMIN et EDITOR publient, archivent ou dépublient ;
  //  - le brouillon reste l'état de travail de l'auteur.
  if (!canTransitionArticle({ id: session.user.id, role: session.user.role }, existing, newStatus)) {
    return;
  }

  await prisma.article.update({
    where: { id: articleId },
    data: {
      status: newStatus,
      // Le passage à PUBLISHED horodate la première publication, sans l'écraser.
      publishedAt:
        newStatus === "PUBLISHED"
          ? (existing.publishedAt ?? new Date())
          : existing.publishedAt,
    },
  });

  revalidatePath("/studio/articles");
  revalidatePath(`/article/${existing.slug}`);
  // Le sélecteur de statut couvrait déjà l'accueil ; sitemap et RSS manquaient.
  if (existing.status === "PUBLISHED" || newStatus === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
}

/** Suppression d'un article, déclenchée depuis la liste. */
export async function deleteArticle(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const id = readText(formData, "id");
  if (!id) {
    return;
  }

  const existing = await prisma.article.findUnique({
    where: { id },
    select: { id: true, authorId: true, status: true },
  });
  if (!existing) {
    return;
  }

  // Suppression : l'auteur ou un éditeur pour les articles non publiés ;
  // un article publié ou archivé ne peut être supprimé que par un ADMIN (WP11).
  if (!canDeleteArticle({ id: session.user.id, role: session.user.role }, existing)) {
    return;
  }

  await prisma.article.deleteMany({ where: { id } });

  revalidatePath("/studio/articles");
  // Supprimer un article publié le retire de l'accueil, du sitemap et du RSS.
  if (existing.status === "PUBLISHED") {
    revalidatePublicSurfaces();
  }
}

const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 Mo

type UploadImageResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Upload d'une image de couverture (Server Action).
 *
 * Appelée directement par le composant client ImageUpload : elle valide le type
 * MIME et la taille, écrit le fichier dans public/uploads/ avec un nom unique,
 * puis renvoie le chemin relatif à enregistrer en base.
 */
export async function uploadImage(
  formData: FormData,
): Promise<UploadImageResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Non authentifié." };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Aucun fichier reçu." };
  }

  const extension = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!extension) {
    return {
      ok: false,
      error: "Format non autorisé. Formats acceptés : JPEG, PNG, WebP, GIF.",
    };
  }

  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, error: "Fichier trop volumineux. Taille maximale : 5 Mo." };
  }
  if (file.size === 0) {
    return { ok: false, error: "Fichier vide." };
  }

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${randomUUID()}${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, filename), bytes);

  return { ok: true, url: `/uploads/${filename}` };
}
