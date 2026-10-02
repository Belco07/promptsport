import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { LoginForm } from "./LoginForm";

/**
 * Page de connexion.
 *
 * Elle est servie sur /login, HORS des préfixes /studio et /backoffice couverts
 * par le middleware : c'est ce qui garantit qu'un visiteur non connecté peut
 * toujours l'atteindre.
 */
export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    // Déjà connecté : redirection selon le rôle.
    redirect(session.user.role === "ADMIN" ? "/backoffice" : "/studio");
  }

  return <LoginForm />;
}
