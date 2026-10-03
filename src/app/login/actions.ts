"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { signIn, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Connexion par identifiants (Server Action).
 * La redirection dépend du rôle : ADMIN → /backoffice, sinon → /studio.
 *
 * Pourquoi la destination est lue en base et non via `auth()` :
 * `signIn({ redirect: false })` dépose le cookie de session dans la **réponse**,
 * alors que `auth()` lit les cookies de la **requête** en cours — il ne voit donc
 * pas encore la session qu'il vient de créer. Conclure « échec » à partir de
 * `auth()` faisait échouer la première tentative (le cookie était pourtant bien
 * posé), et la connexion ne réussissait qu'à la deuxième, quand le navigateur
 * renvoyait ce cookie. On lit donc le rôle dans la base, pour l'adresse qui vient
 * d'être authentifiée par `authorize`.
 */
export async function authenticate(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.type === "CredentialsSignin") {
        return "Email ou mot de passe incorrect.";
      }
      return "La connexion a échoué. Merci de réessayer.";
    }
    throw error;
  }

  // Identifiants validés et cookie de session posé sur la réponse : on peut
  // rediriger immédiatement, sans relire la session.
  const author = await prisma.author.findUnique({
    where: { email },
    select: { role: true },
  });

  redirect(author?.role === "ADMIN" ? "/backoffice" : "/studio");
}

/** Déconnexion puis retour au formulaire de connexion. */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
