"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { followTeam, unfollowTeam, followCompetition, unfollowCompetition } from "@/app/mon-sport/actions";

export function FollowButton({ id, kind, name, following, signedIn, unfollowLabel = false }: {
  id: string; kind: "team" | "competition"; name: string; following: boolean; signedIn: boolean; unfollowLabel?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  return <div className="shrink-0">
    <Button size="sm" variant={following ? "primary" : "secondary"} disabled={pending}
      aria-pressed={following} aria-label={`${following ? "Ne plus suivre" : "Suivre"} ${name}`}
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
      }}>
      {following ? <Check size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
      {pending ? "Enregistrement…" : following ? (unfollowLabel ? "Ne plus suivre" : "Suivi") : "Suivre"}
    </Button>
    {error && <p role="alert" className="mt-2 max-w-64 text-sm text-destructive">{error}</p>}
  </div>;
}
