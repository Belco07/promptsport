"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSlug } from "@/lib/slug";

/**
 * Server Actions du CRUD catégories.
 */

/** Code Prisma d'une violation de contrainte d'unicité (slug/name déjà pris). */
const UNIQUE_CONSTRAINT_VIOLATION = "P2002";
/** Code Prisma d'une violation de clé étrangère (catégorie encore référencée). */
const FOREIGN_KEY_VIOLATION = "P2003";

function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

function isForeignKeyError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === FOREIGN_KEY_VIOLATION
  );
}

type CategoryInput = {
  name: string;
  slug: string;
};

function validate(formData: FormData): CategoryInput | { error: string } {
  const name = readText(formData, "name");
  if (!name) {
    return { error: "Le nom est obligatoire." };
  }

  const slug = resolveSlug(readText(formData, "slug"), name);
  if (!slug) {
    return {
      error:
        "Impossible de générer un slug depuis le nom : saisissez un slug manuellement.",
    };
  }

  return { name, slug };
}

/** Création d'une catégorie. */
export async function createCategory(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const result = validate(formData);
  if ("error" in result) {
    return result.error;
  }

  try {
    await prisma.category.create({ data: result });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "Une catégorie avec ce nom ou ce slug existe déjà.";
    }
    throw error;
  }

  revalidatePath("/studio/categories");
  redirect("/studio/categories");
}

/** Mise à jour d'une catégorie. */
export async function updateCategory(
  id: string,
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) {
    return "Cette catégorie n'existe plus.";
  }

  const result = validate(formData);
  if ("error" in result) {
    return result.error;
  }

  try {
    await prisma.category.update({ where: { id }, data: result });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "Une catégorie avec ce nom ou ce slug existe déjà.";
    }
    throw error;
  }

  revalidatePath("/studio/categories");
  redirect("/studio/categories");
}

type DeleteCategoryResult = { ok: true } | { ok: false; error: string };

/** Suppression d'une catégorie (refusée si des articles la référencent). */
export async function deleteCategory(formData: FormData): Promise<DeleteCategoryResult> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const id = readText(formData, "id");
  if (!id) {
    return { ok: false, error: "Catégorie introuvable." };
  }

  try {
    await prisma.category.delete({ where: { id } });
  } catch (error) {
    if (isForeignKeyError(error)) {
      return {
        ok: false,
        error:
          "Impossible de supprimer cette catégorie : des articles y sont rattachés. Réassignez-les d'abord.",
      };
    }
    throw error;
  }

  revalidatePath("/studio/categories");
  return { ok: true };
}
