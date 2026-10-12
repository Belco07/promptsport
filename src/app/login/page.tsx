import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { LoginForm } from "./LoginForm";
import { availableOAuthProviders } from "@/lib/oauth-providers";
import { prisma } from "@/lib/prisma";

/**
 * Page de connexion.
 *
 * Elle est servie sur /login, HORS des préfixes /studio et /backoffice couverts
 * par le middleware : c'est ce qui garantit qu'un visiteur non connecté peut
 * toujours l'atteindre.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const session = await auth();
  if (session?.user) {
    if (session.user.role === "READER") {
      const reader = await prisma.author.findUnique({ where: { id: session.user.id }, select: { welcomeCompleted: true } });
      if (reader && !reader.welcomeCompleted) redirect("/bienvenue");
    }
    // Déjà connecté : redirection selon le rôle.
    redirect(session.user.role === "ADMIN" ? "/backoffice" : session.user.role === "READER" ? "/mon-compte" : "/studio");
  }

  return <LoginForm providers={availableOAuthProviders()} oauthError={error} />;
}
