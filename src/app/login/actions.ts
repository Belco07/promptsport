"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, signIn, signOut } from "@/lib/auth";

/**
 * Connexion par identifiants (Server Action).
 * La redirection dépend du rôle : ADMIN → /backoffice, sinon → /studio.
 */
export async function authenticate(
  _previousState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const email = String(formData.get("email") ?? "");
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

  const session = await auth();
  if (!session?.user) {
    return "La connexion a échoué. Merci de réessayer.";
  }

  redirect(session.user.role === "ADMIN" ? "/backoffice" : "/studio");
}

/** Déconnexion puis retour au formulaire de connexion. */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
