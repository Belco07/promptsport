"use client";
import { useActionState } from "react";
import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Bookmark, CreditCard } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SocialSignIn } from "@/components/SocialSignIn";
import { register } from "./actions";

export function RegisterForm({ providers }: { providers: { google: boolean; facebook: boolean } }) {
  const [error, action, pending] = useActionState(register, undefined);
  const field = "h-[60px] w-full border border-muted-foreground bg-transparent px-4 text-foreground placeholder:text-muted-foreground";
  return <div className="public-site min-h-screen bg-background text-foreground">
    <header className="border-b border-border bg-foreground dark:bg-background"><div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-5 md:px-8"><Link href="/" aria-label="PromptSport — accueil"><Image src="/promptsport-logo-night.png" alt="PromptSport" width={4739} height={1044} className="h-auto w-44" priority /></Link><div className="bg-background p-1"><ThemeToggle /></div></div></header>
    <main id="contenu" className="mx-auto max-w-[1280px] px-5 py-12 md:px-8">
      <h1 className="mb-12 text-3xl font-black uppercase md:text-[42px]">Créer un compte</h1>
      <div className="grid gap-12 lg:grid-cols-[3fr_2fr] lg:gap-16"><div>
        <form action={action} className="space-y-4" aria-busy={pending}>
          <label className="block"><span className="sr-only">Prénom</span><input name="name" autoComplete="given-name" placeholder="PRÉNOM" minLength={2} maxLength={100} required className={field} /></label>
          <label className="block"><span className="sr-only">Adresse e-mail</span><input name="email" type="email" autoComplete="email" placeholder="ADRESSE E-MAIL" maxLength={254} required className={field} /></label>
          <label className="block"><span className="sr-only">Mot de passe</span><input name="password" type="password" autoComplete="new-password" placeholder="MOT DE PASSE" minLength={12} maxLength={72} required aria-describedby="password-hint" className={field} /></label>
          <p id="password-hint" className="text-sm text-muted-foreground">Utilisez au moins 12 caractères pour votre mot de passe.</p>
          <label className="flex items-start gap-3 border-t border-border pt-6 text-sm leading-6"><input name="terms" type="checkbox" required className="mt-1 h-5 w-5 shrink-0" /><span>J’ai lu la <Link href="/confidentialite" className="text-editorial-link underline">politique de confidentialité</Link>.</span></label>
          {error && <p role="alert" className="text-status-error-foreground">{error}</p>}
          <button disabled={pending} className="min-h-[60px] w-full bg-primary px-6 py-4 font-extrabold uppercase text-primary-foreground disabled:opacity-50">{pending ? "Création en cours…" : "Créer un compte et continuer"}</button>
        </form>
        <SocialSignIn providers={providers} />
        <p className="mt-8">Déjà un compte ? <Link href="/login" className="font-bold text-editorial-link hover:underline">Se connecter</Link></p>
      </div><aside className="border-t border-border pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0"><h2 className="mb-8 text-2xl font-bold">Votre espace personnel PromptSport</h2><ul className="space-y-8"><li className="flex gap-4"><MessageCircle className="shrink-0 text-editorial-link" />Réagissez aux articles et participez aux discussions.</li><li className="flex gap-4"><Bookmark className="shrink-0 text-editorial-link" />Enregistrez les articles que vous souhaitez retrouver.</li><li className="flex gap-4"><CreditCard className="shrink-0 text-editorial-link" />Gérez votre profil et votre abonnement depuis votre compte.</li></ul></aside></div>
      <Link href="/" className="mt-12 inline-block text-editorial-link hover:underline">← Continuer la navigation</Link>
    </main>
  </div>;
}
