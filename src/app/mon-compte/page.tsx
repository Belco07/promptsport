import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Footer } from "@/components/Footer";
import { FollowedTeamsList } from "@/components/FollowedTeamsList";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";

import { updatePassword, updateProfile } from "./actions";

/**
 * Détails du compte : uniquement l'identité et les identifiants. L'abonnement,
 * les notifications et l'historique des paiements ont leurs propres pages
 * (/mon-compte/abonnement, /mon-compte/notifications) : pas de doublon ici.
 *
 * Présentation alignée sur le formulaire de connexion : ni carte, ni ombre,
 * mêmes champs et mêmes boutons.
 */

export const metadata: Metadata = {
  title: "Mon compte",
  description: "Votre profil et vos identifiants.",
};

export const dynamic = "force-dynamic";

/** Champs et boutons : mêmes classes que le formulaire de connexion. */
const FIELD_CLASS =
  "h-[60px] w-full rounded-none border border-muted-foreground bg-transparent px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-editorial-link focus:ring-1 focus:ring-editorial-link disabled:opacity-60";
const LABEL_CLASS = "mb-2 block text-xs font-bold uppercase tracking-wide text-foreground";
const BUTTON_CLASS =
  "min-h-[60px] w-full bg-primary px-10 py-4 text-base font-extrabold uppercase text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

/** Codes d'erreur renvoyés par les Server Actions. */
const ERROR_MESSAGES: Record<string, string> = {
  "nom-court": "Le nom doit contenir au moins 2 caractères.",
  "nom-long": "Le nom ne peut pas dépasser 80 caractères.",
  "motdepasse-champs": "Tous les champs de mot de passe sont obligatoires.",
  "motdepasse-court": "Le nouveau mot de passe doit contenir au moins 6 caractères.",
  "motdepasse-different": "Les deux saisies du nouveau mot de passe ne correspondent pas.",
  "motdepasse-identique": "Le nouveau mot de passe doit être différent de l'actuel.",
  "motdepasse-actuel": "Le mot de passe actuel est incorrect.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ profil?: string; motdepasse?: string; erreur?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const params = await searchParams;

  const author = await prisma.author.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, createdAt: true },
  });

  if (!author) {
    redirect("/login");
  }

  const successMessage =
    params.profil === "maj"
      ? "Votre nom a bien été mis à jour."
      : params.motdepasse === "maj"
        ? "Votre mot de passe a bien été modifié."
        : null;
  const errorMessage = params.erreur
    ? (ERROR_MESSAGES[params.erreur] ?? "Une erreur est survenue.")
    : null;

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-[832px] px-5 pb-16 pt-10 md:px-8 md:pt-14">
        <h1 className="mb-4 text-3xl font-black uppercase tracking-tight md:text-[42px]">
          Mon compte
        </h1>
        <p className="mb-10 text-sm text-muted-foreground md:mb-12">
          {author.name} · {author.email} — membre depuis le {formatDate(author.createdAt)}
        </p>

        {successMessage ? (
          <p
            role="status"
            className="mb-6 border-l-2 border-status-success-border bg-status-success p-4 text-sm text-status-success-foreground"
          >
            {successMessage}
          </p>
        ) : null}
        {errorMessage ? (
          <p
            role="alert"
            className="mb-6 border-l-2 border-status-error-border bg-status-error p-4 text-sm text-status-error-foreground"
          >
            {errorMessage}
          </p>
        ) : null}

        {/* ---------------------------------------------------------- Profil */}
        <section>
          <h2 className="mb-6 text-xl font-extrabold uppercase tracking-tight">Profil</h2>
          <form action={updateProfile} className="space-y-4">
            <div>
              <label htmlFor="name" className={LABEL_CLASS}>
                Nom affiché
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                defaultValue={author.name ?? ""}
                aria-describedby="name-aide"
                className={FIELD_CLASS}
              />
              <p id="name-aide" className="mt-2 text-xs text-muted-foreground">
                Ce nom signe vos articles et apparaît dans la navigation.
              </p>
            </div>

            <div>
              <label htmlFor="email" className={LABEL_CLASS}>
                Adresse e-mail
              </label>
              <input
                id="email"
                type="email"
                value={author.email}
                readOnly
                disabled
                aria-describedby="email-aide"
                className={FIELD_CLASS}
              />
              <p id="email-aide" className="mt-2 text-xs text-muted-foreground">
                La modification de l&apos;e-mail arrivera plus tard : elle nécessite une vérification
                par e-mail.
              </p>
            </div>

            <div className="pt-6">
              <button type="submit" className={BUTTON_CLASS}>
                Enregistrer
              </button>
            </div>
          </form>
        </section>

        {/* -------------------------------------------------------- Sécurité */}
        <section className="mt-14 border-t border-border pt-10">
          <h2 className="mb-6 text-xl font-extrabold uppercase tracking-tight">Sécurité</h2>
          <form action={updatePassword} className="space-y-4">
            <div>
              <label htmlFor="currentPassword" className={LABEL_CLASS}>
                Mot de passe actuel
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                autoComplete="current-password"
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label htmlFor="newPassword" className={LABEL_CLASS}>
                Nouveau mot de passe
              </label>
              <input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                aria-describedby="newPassword-aide"
                className={FIELD_CLASS}
              />
              <p id="newPassword-aide" className="mt-2 text-xs text-muted-foreground">
                6 caractères minimum.
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className={LABEL_CLASS}>
                Confirmation du nouveau mot de passe
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                className={FIELD_CLASS}
              />
            </div>

            <div className="pt-6">
              <button type="submit" className={BUTTON_CLASS}>
                Modifier le mot de passe
              </button>
            </div>
          </form>
        </section>
        <FollowedTeamsList userId={session.user.id} />
      </main>

      <Footer />
    </>
  );
}
