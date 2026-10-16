"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { voteForManOfTheMatch } from "@/app/match/[id]/actions";

export function ManOfTheMatchVote({ matchId, candidates, signedIn, choice }: { matchId: string; candidates: { id: string; name: string; club: string }[]; signedIn: boolean; choice: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  if (!signedIn) return <p className="mt-3 text-sm text-muted-foreground"><Link href={`/login?callbackUrl=${encodeURIComponent(`/match/${matchId}`)}`} className="font-semibold text-editorial-link underline">Connectez-vous</Link> pour voter pour l’homme du match.</p>;
  if (!candidates.length) return <p className="mt-3 text-sm text-muted-foreground">Vote disponible dès que les participants du match seront renseignés.</p>;
  return <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); const playerId = new FormData(event.currentTarget).get("playerId"); if (typeof playerId !== "string") return; startTransition(async () => { try { const result = await voteForManOfTheMatch(matchId, playerId); setMessage(result.message); if (result.ok) router.refresh(); } catch { setMessage("Impossible d’enregistrer le vote. Réessayez."); } }); }}>
    <label className="block text-sm font-medium text-foreground" htmlFor={`motm-${matchId}`}>Votre homme du match</label>
    <select id={`motm-${matchId}`} name="playerId" defaultValue={choice ?? ""} required disabled={pending} className="w-full rounded-lg border border-border bg-background p-3 text-foreground"><option value="" disabled>Choisir un joueur</option>{candidates.map(player => <option key={player.id} value={player.id}>{player.name} · {player.club}</option>)}</select>
    <button disabled={pending} className="rounded-lg bg-secondary px-4 py-2 text-sm font-bold text-foreground disabled:opacity-50">{pending ? "Enregistrement…" : choice ? "Modifier mon vote" : "Voter"}</button>
    <p role="status" className="text-sm text-muted-foreground">{message || (choice ? "Votre vote est enregistré. Une seule voix par lecteur." : "Une seule voix par lecteur et par match.")}</p>
  </form>;
}
