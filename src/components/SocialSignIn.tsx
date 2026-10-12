"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function SocialSignIn({ providers }: { providers: { google: boolean; facebook: boolean } }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!providers.google && !providers.facebook) return null;
  async function connect(provider: string) {
    setPending(true);
    setError("");
    try { await signIn(provider, { redirectTo: "/bienvenue" }); }
    catch { setError("La connexion n’a pas abouti. Réessayez."); setPending(false); }
  }
  return <section aria-label="Autres modes de connexion" className="mt-10 max-w-md space-y-3">
    <p className="mb-5 text-center">Autres façons de se connecter</p>
    {(["google", "facebook"] as const).filter(p => providers[p]).map(p => <button key={p} type="button" disabled={pending} onClick={() => connect(p)} className="flex min-h-12 w-full items-center justify-center gap-4 rounded-full border border-border bg-white px-5 py-3 font-semibold text-black disabled:opacity-50"><span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-xl font-bold text-white">{p === "google" ? "G" : "f"}</span>Continuer avec {p === "google" ? "Google" : "Facebook"}</button>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
