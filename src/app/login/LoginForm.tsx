"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { LoginCard, type OAuthProviders } from "@/components/LoginCard";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Page de connexion : la carte de connexion (disposition de la référence
 * « Digital Haven ») centrée sous l'en-tête de la page.
 */
export function LoginForm({ providers, oauthError }: { providers: OAuthProviders; oauthError?: string }) {
  return (
    <div className="public-site min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-foreground dark:bg-background">
        <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-5 md:px-8">
          <Link href="/" aria-label="PromptSport — retour à l’accueil"><Image src="/promptsport-logo-night.png" alt="PromptSport" width={4739} height={1044} priority sizes="180px" className="h-auto w-44" /></Link>
          <div className="rounded border border-primary-foreground/30 bg-background p-1"><ThemeToggle /></div>
        </div>
      </header>
      <main id="contenu" className="mx-auto flex w-full max-w-[832px] flex-col items-center px-5 pb-16 pt-10 md:px-8 md:pt-14">
        <LoginCard providers={providers} oauthError={oauthError} />
        <Link href="/" className="mt-10 inline-flex items-center gap-2 text-base font-medium text-editorial-link hover:underline"><ArrowLeft size={20} aria-hidden="true" />Continuer la navigation</Link>
        <footer className="mt-14 w-full border-t border-border pt-5 text-center"><Link href="/confidentialite" className="text-xs text-muted-foreground hover:underline">Politique de confidentialité</Link></footer>
      </main>
    </div>
  );
}
