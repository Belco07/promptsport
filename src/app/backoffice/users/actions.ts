"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isUserRole, type UserRole } from "@/lib/roles";

/**
 * Server Actions de gestion des utilisateurs (backoffice, ADMIN uniquement).
 */

function readText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Lecture d'une case à cocher : absente du FormData quand elle est décochée.
 * Les valeurs « false »/« off »/vide comptent comme décochées.
 */
function readCheckbox(formData: FormData, field: string): boolean {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return false;
  }
  return !["", "false", "off", "0"].includes(value.toLowerCase());
}

/** Vérifie que l'appelant est ADMIN ; redirige sinon. */
async function requireAdmin() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }
  return session;
}

type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Case « Recevoir la newsletter » du formulaire (WP11c). */
  newsletter: boolean;
};

async function validateCreate(formData: FormData): Promise<CreateUserInput | { error: string }> {
  const name = readText(formData, "name");
  const email = readText(formData, "email").toLowerCase();
  const password = readText(formData, "password");
  const roleRaw = readText(formData, "role");

  if (!name) return { error: "Le nom est obligatoire." };
  if (!email || !email.includes("@")) return { error: "Email invalide." };
  if (!password) return { error: "Le mot de passe est obligatoire." };
  if (password.length < 6) return { error: "Le mot de passe doit contenir au moins 6 caractères." };
  if (!isUserRole(roleRaw)) return { error: "Rôle invalide." };

  return {
    name,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: roleRaw,
    newsletter: readCheckbox(formData, "newsletter"),
  };
}

type UpdateUserInput = {
  name: string;
  email: string;
  role: UserRole;
};

async function validateUpdate(formData: FormData): Promise<UpdateUserInput | { error: string }> {
  const name = readText(formData, "name");
  const email = readText(formData, "email").toLowerCase();
  const roleRaw = readText(formData, "role");

  if (!name) return { error: "Le nom est obligatoire." };
  if (!email || !email.includes("@")) return { error: "Email invalide." };
  if (!isUserRole(roleRaw)) return { error: "Rôle invalide." };

  return { name, email, role: roleRaw };
}

/** Création d'un utilisateur. */
export async function createUser(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  await requireAdmin();

  const result = await validateCreate(formData);
  if ("error" in result) {
    return result.error;
  }

  const existing = await prisma.author.findUnique({ where: { email: result.email } });
  if (existing) {
    return "Un utilisateur avec cet email existe déjà.";
  }

  const { newsletter, ...author } = result;
  const created = await prisma.author.create({ data: author, select: { id: true } });

  // Case « Recevoir la newsletter » (WP11c) : l'adresse du compte est réputée
  // vérifiée par l'administrateur qui crée le compte, donc l'abonnement est
  // directement CONFIRMED — pas de double opt-in pour une saisie interne.
  // Un abonné existant pour la même adresse est simplement rattaché au compte.
  if (newsletter) {
    await prisma.newsletterSubscriber.upsert({
      where: { email: result.email },
      create: {
        email: result.email,
        name: result.name,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        source: "compte",
        userId: created.id,
      },
      update: {
        userId: created.id,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        unsubscribedAt: null,
      },
    });
  }

  revalidatePath("/backoffice/users");
  redirect("/backoffice/users");
}

/** Mise à jour d'un utilisateur (nom, email, rôle — pas le mot de passe). */
export async function updateUser(
  id: string,
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const session = await requireAdmin();

  const target = await prisma.author.findUnique({ where: { id } });
  if (!target) {
    return "Cet utilisateur n'existe plus.";
  }

  const result = await validateUpdate(formData);
  if ("error" in result) {
    return result.error;
  }

  // Garde-fou : un admin ne peut pas se rétrograder lui-même.
  if (id === session.user.id && result.role !== "ADMIN") {
    return "Vous ne pouvez pas vous rétrograder vous-même.";
  }

  const existingEmail = await prisma.author.findUnique({ where: { email: result.email } });
  if (existingEmail && existingEmail.id !== id) {
    return "Un utilisateur avec cet email existe déjà.";
  }

  await prisma.author.update({ where: { id }, data: result });

  revalidatePath("/backoffice/users");
  redirect("/backoffice/users");
}

type DeleteUserResult = { ok: true } | { ok: false; error: string };

/** Suppression d'un utilisateur (impossible pour son propre compte). */
export async function deleteUser(formData: FormData): Promise<DeleteUserResult> {
  const session = await requireAdmin();

  const id = readText(formData, "id");
  if (!id) {
    return { ok: false, error: "Utilisateur introuvable." };
  }

  if (id === session.user.id) {
    return { ok: false, error: "Vous ne pouvez pas supprimer votre propre compte." };
  }

  await prisma.author.delete({ where: { id } });

  revalidatePath("/backoffice/users");
  return { ok: true };
}
