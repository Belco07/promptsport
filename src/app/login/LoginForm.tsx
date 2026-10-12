"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useActionState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { authenticate } from "./actions";
import { SocialSignIn } from "@/components/SocialSignIn";

export function LoginForm({ providers, oauthError }: { providers: { google: boolean; facebook: boolean }; oauthError?: string }) {
  const [errorMessage, formAction, isPending] = useActionState(authenticate, undefined);
  const fieldClass = "h-[60px] w-full rounded-none border border-muted-foreground bg-transparent px-4 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-editorial-link focus:ring-1 focus:ring-editorial-link";
  return (
    <div className="public-site min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-foreground dark:bg-background">
        <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-5 md:px-8">
          <Link href="/" aria-label="PromptSport — retour à l’accueil"><Image src="/promptsport-logo-night.png" alt="PromptSport" width={4739} height={1044} priority sizes="180px" className="h-auto w-44" /></Link>
          <div className="rounded border border-primary-foreground/30 bg-background p-1"><ThemeToggle /></div>
        </div>
      </header>
      <main id="contenu" className="mx-auto w-full max-w-[832px] px-5 pb-16 pt-10 md:px-8 md:pt-14">
        <h1 className="mb-9 text-3xl font-black uppercase tracking-tight md:mb-11 md:text-[42px]">Se connecter</h1>
        {oauthError && <p role="alert" className="mb-6 text-status-error-foreground">{oauthError === "OAuthAccountNotLinked" ? "Cette adresse possède déjà un compte. Utilisez votre mode de connexion habituel." : "La connexion n’a pas abouti. Réessayez avec votre mode de connexion habituel."}</p>}
        <form action={formAction} className="space-y-4" aria-busy={isPending}>
          <div><label htmlFor="email" className="sr-only">Adresse e-mail</label><input id="email" name="email" type="email" autoComplete="email" placeholder="ADRESSE E-MAIL" required className={fieldClass} /></div>
          <div><label htmlFor="password" className="sr-only">Mot de passe</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="MOT DE PASSE" required className={fieldClass} /></div>
          {errorMessage && <p id="login-error" role="alert" className="border-l-2 border-status-error-border bg-status-error p-4 text-sm text-status-error-foreground">{errorMessage}</p>}
          <div className="pt-6"><button type="submit" disabled={isPending} className="min-h-[60px] w-full bg-primary px-10 py-4 text-base font-extrabold uppercase text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{isPending ? "Connexion…" : "Se connecter"}</button></div>
        </form>
        <SocialSignIn providers={providers} />
        <p className="mt-10">Pas encore de compte ? <Link href="/inscription" className="font-bold text-editorial-link hover:underline">Créer un compte</Link></p>
        <Link href="/" className="mt-14 inline-flex items-center gap-2 text-base font-medium text-editorial-link hover:underline"><ArrowLeft size={20} aria-hidden="true" />Continuer la navigation</Link>
        <footer className="mt-14 border-t border-border pt-5"><Link href="/confidentialite" className="text-xs text-muted-foreground hover:underline">Politique de confidentialité</Link></footer>
      </main>
    </div>
  );
}
