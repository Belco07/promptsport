"use client";

import { useState, useTransition } from "react";
import { Star } from "lucide-react";
import { followClub } from "@/app/club/[slug]/actions";

export function FollowClubButton({ clubId, preferred }: { clubId: string; preferred: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return <div><button type="button" aria-pressed={preferred} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-foreground disabled:opacity-50" onClick={() => startTransition(async () => { try { const result = await followClub(clubId); setMessage(result.message); } catch { setMessage("Impossible de modifier votre club préféré."); } })}><Star aria-hidden="true" size={18} fill={preferred ? "currentColor" : "none"}/>{pending ? "Enregistrement…" : preferred ? "Club préféré" : "Définir comme club préféré"}</button><p role="status" className="mt-1 text-xs text-muted-foreground">{message}</p></div>;
}
