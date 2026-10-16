"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { voteForManOfTheMatch } from "@/app/club/[slug]/actions";

export function ManOfTheMatchVote({ matchId, candidates, signedIn, choice }: { matchId: string; candidates: { id: string; name: string; club: string }[]; signedIn: boolean; choice: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  if (!signedIn) return <p className="mt-3 text-sm text-muted-foreground"><Link href={`/login?callbackUrl=${encodeURIComponent(`/match/${matchId}`)}`} className="font-semibold text-editorial-link underline">Connectez-vous</Link> pour voter pour l’homme du match.</p>;
  if (!candidates.length) return <p className="mt-3 text-sm text-muted-foreground">Vote disponible dès que les participants du match seront renseignés.</p>;
  return <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); const playerId = new FormData(event.currentTarget).get("playerId"); if (typeof playerId !== "string") return; startTransition(async () => { try { const result = await voteForManOfTheMatch(matchId, playerId); setMessage(result.message); if (result.ok) router.refresh(); } catch { setMessage("Impossible d’enregistrer le vote. Réessayez."); } }); }}>
    <fieldset disabled={pending} className="rounded-lg border border-border p-3"><legend className="px-1 text-sm font-semibold text-foreground">Votre homme du match</legend><div className="grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-2">{candidates.map(player => <label key={player.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-foreground hover:bg-secondary"><input type="radio" name="playerId" value={player.id} defaultChecked={choice === player.id} required className="h-4 w-4 shrink-0 accent-current"/><span>{player.name}<span className="block text-xs text-muted-foreground">{player.club}</span></span></label>)}</div></fieldset>
    <button disabled={pending} className="min-h-11 rounded-lg bg-secondary px-4 py-2 text-sm font-bold text-foreground disabled:opacity-50">{pending ? "Enregistrement…" : choice ? "Modifier mon vote" : "Voter"}</button>
    <p role="status" className="text-sm text-muted-foreground">{message || (choice ? "Votre vote est enregistré. Une seule voix par lecteur." : "Une seule voix par lecteur et par match.")}</p>
  </form>;
}
