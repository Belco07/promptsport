"use client";

import Link from "next/link";
import { useActionState } from "react";

import { subscribeToNewsletter, type SubscribeState } from "@/app/newsletter/actions";

/**
 * Inscription à la newsletter du pied de page, disposée comme la référence
 * « Digital Haven » : champ e-mail pleine largeur, bouton dessous, puis case de
 * consentement. Même Server Action que la page /newsletter (double opt-in,
 * consentement obligatoire, limitation de débit) ; le choix des listes reste
 * sur la page dédiée.
 */
export function FooterNewsletterForm() {
  const [state, formAction, isPending] = useActionState<SubscribeState | undefined, FormData>(
    subscribeToNewsletter,
    undefined,
  );
  const ok = state?.code === "ok" || state?.code === "already";

  return (
    <form action={formAction} className="mt-[15px]">
      <label htmlFor="pied-newsletter-email" className="sr-only">Adresse e-mail</label>
      <input
        id="pied-newsletter-email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="Votre adresse e-mail"
        className="block h-[47px] w-full rounded-[13px] border border-border bg-background px-5 text-base font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground"
      />
      <button
        type="submit"
        disabled={isPending}
        className="app-button mt-[25px] inline-flex h-[42px] items-center rounded-[13px] bg-foreground px-[30px] text-lg font-bold text-background transition-opacity hover:opacity-85"
      >
        {isPending ? "Inscription…" : "S'inscrire maintenant"}
      </button>
      <label className="mt-5 flex items-start gap-2 text-[13px] text-muted-foreground">
        <input name="consentement" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 rounded border-border" />
        <span>
          J&apos;ai lu et j&apos;accepte la{" "}
          <Link href="/confidentialite" className="font-semibold underline hover:text-foreground">politique de confidentialité</Link>.
          Confirmation par e-mail, désabonnement en un clic.
        </span>
      </label>
      {state ? (
        <p role={ok ? "status" : "alert"} className={`mt-3 text-sm font-medium ${ok ? "text-status-success-foreground" : "text-status-error-foreground"}`}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
