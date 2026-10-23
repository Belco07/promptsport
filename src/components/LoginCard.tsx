"use client";

import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { authenticate } from "@/app/login/actions";
import { Eye, EyeOff } from "@/components/icons";
import { SocialSignIn } from "@/components/SocialSignIn";

export type OAuthProviders = { google: boolean; facebook: boolean };

/**
 * Carte de connexion disposée comme la fenêtre de connexion de la référence
 * « Digital Haven » : titre centré et accroche, petit filet pointillé, libellés
 * précédés d'une pastille, champs arrondis, mot de passe affichable, bouton
 * pleine largeur, puis lien d'inscription.
 *
 * Utilisée par la page /login et par la fenêtre qui s'ouvre depuis l'icône
 * compte de l'en-tête. Même Server Action (`authenticate`) dans les deux cas.
 * Les options « Se souvenir de moi » et « Mot de passe oublié » de la
 * référence ne sont pas reprises : le site ne les propose pas.
 */
export function LoginCard({
  providers,
  oauthError,
  as: Heading = "h1",
}: {
  providers: OAuthProviders;
  oauthError?: string;
  as?: "h1" | "h2";
}) {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);
  const [showPassword, setShowPassword] = useState(false);
  const id = useId();
  const field = "block h-12 w-full rounded-[13px] border border-border bg-background px-5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-editorial-link focus:ring-1 focus:ring-editorial-link";
  const label = "mb-[7px] flex items-center gap-2 text-[13px] text-muted-foreground";
  const dot = <span aria-hidden="true" className="h-[0.8em] w-[0.8em] rounded-full bg-accent" />;

  return (
    <div className="w-full max-w-[400px] rounded-[13px] border border-border bg-card px-5 pb-5 pt-[25px] text-foreground shadow-[0_10px_30px_rgb(0_0_0/12%)] sm:px-[25px] sm:pb-[25px] sm:pt-10">
      <div className="mb-[25px] flex flex-col items-center pb-5 text-center">
        <Heading className="text-2xl font-black tracking-tight">Bon retour !</Heading>
        <p className="mt-1 text-sm text-muted-foreground">Connectez-vous à votre compte</p>
        <span aria-hidden="true" className="mt-5 block w-[30px] border-b-[6px] border-dotted border-accent" />
      </div>

      {oauthError && (
        <p role="alert" className="mb-4 text-sm text-status-error-foreground">
          {oauthError === "OAuthAccountNotLinked"
            ? "Cette adresse possède déjà un compte. Utilisez votre mode de connexion habituel."
            : "La connexion n’a pas abouti. Réessayez avec votre mode de connexion habituel."}
        </p>
      )}

      <form action={formAction} className="flex flex-col gap-[15px]" aria-busy={isPending}>
        <div>
          <label htmlFor={`${id}-email`} className={label}>{dot}Adresse e-mail</label>
          <input id={`${id}-email`} name="email" type="email" autoComplete="email" required className={field} />
        </div>
        <div>
          <label htmlFor={`${id}-password`} className={label}>{dot}Mot de passe</label>
          <div className="relative">
            <input id={`${id}-password`} name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" spellCheck={false} required className={`${field} pr-12`} />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
            </button>
          </div>
        </div>
        {errorMessage && (
          <p role="alert" className="rounded-[13px] border border-status-error-border bg-status-error px-4 py-3 text-sm text-status-error-foreground">
            {errorMessage}
          </p>
        )}
        <div className="pt-[10px]">
          <button type="submit" disabled={isPending} className="flex h-11 w-full items-center justify-center rounded-[13px] bg-primary text-base font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60">
            {isPending ? "Connexion…" : "Se connecter"}
          </button>
        </div>
      </form>

      <SocialSignIn providers={providers} />

      <p className="mt-[15px] text-center text-[13px] text-muted-foreground">
        Pas encore de compte ?
        <Link href="/inscription" className="pl-[5px] font-bold text-foreground hover:text-editorial-link hover:underline">Créer un compte</Link>
      </p>
    </div>
  );
}
