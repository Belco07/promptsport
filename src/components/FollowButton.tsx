"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Star } from "@/components/icons";
import { followTeam, unfollowTeam, followCompetition, unfollowCompetition } from "@/app/mon-sport/actions";

/**
 * Petit bouton « Suivre » / « Suivi », partagé par les pastilles de club et de
 * compétition et par les en-têtes de page : même taille partout (28 px de haut,
 * libellé de 11 px), arrondi complet.
 */
export function FollowToggle({ name, following, pending, onClick, unfollowLabel = false }: {
  name: string; following: boolean; pending: boolean; onClick: () => void; unfollowLabel?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={following}
      aria-label={`${following ? "Ne plus suivre" : "Suivre"} ${name}`}
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center gap-1 !rounded-full border px-3 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        following
          ? "border-foreground bg-foreground text-background hover:opacity-85"
          : "border-border bg-background text-foreground hover:border-foreground"
      }`}
    >
      {following ? <Check size={12} aria-hidden="true" /> : <Star size={12} aria-hidden="true" />}
      {pending ? "…" : following ? (unfollowLabel ? "Ne plus suivre" : "Suivi") : "Suivre"}
    </button>
  );
}

export function FollowButton({ id, kind, name, following, signedIn, unfollowLabel = false }: {
  id: string; kind: "team" | "competition"; name: string; following: boolean; signedIn: boolean; unfollowLabel?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <div className="shrink-0">
    <FollowToggle
      name={name}
      following={following}
      pending={pending}
      unfollowLabel={unfollowLabel}
      onClick={() => {
        if (!signedIn) { router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`); return; }
        setError("");
        startTransition(async () => {
          try {
            const action = kind === "team" ? (following ? unfollowTeam : followTeam) : (following ? unfollowCompetition : followCompetition);
            const result = await action(id);
            if (!result.ok) setError(result.error); else router.refresh();
          } catch { setError("Connexion interrompue. Réessayez."); }
        });
      }}
    />
    {error && <p role="alert" className="mt-2 max-w-64 text-sm text-destructive">{error}</p>}
  </div>;
}
