"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClubPulseData } from "@/lib/club-digest";

function countdown(date: string, now: number) {
  const hours = Math.max(0, Math.ceil((new Date(date).getTime() - now) / 3600000));
  return hours > 24 ? `J-${Math.ceil(hours / 24)}` : hours > 0 ? `H-${hours}` : "Début imminent";
}
export function ClubPulse({ pulse }: { pulse: ClubPulseData }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const update = () => { if (!document.hidden) setNow(Date.now()); }; update(); const timer = setInterval(update, 60000); document.addEventListener("visibilitychange", update); return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); }; }, []);
  return <section aria-label="Pulse du club" className="my-6 grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-4">
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Prochain match</h2>{pulse.next ? <Link href={`/match/${pulse.next.id}`} className="text-sm text-foreground"><strong className="mb-1 block text-xl text-editorial-link">{now === null ? "À venir" : countdown(pulse.next.scheduledAt, now)}</strong>{pulse.next.home} – {pulse.next.away}<span className="mt-1 block text-xs text-muted-foreground">{new Date(pulse.next.scheduledAt).toLocaleString("fr-FR", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" })}</span></Link> : <p className="text-sm text-muted-foreground">Aucun match programmé.</p>}</div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Forme actuelle</h2><div className="flex gap-1" aria-label="Résultats du plus récent au plus ancien">{pulse.form.length ? pulse.form.map(({ matchId, result }) => <Link key={matchId} href={`/match/${matchId}`} aria-label={`${result === "V" ? "Victoire" : result === "N" ? "Match nul" : result === "D" ? "Défaite" : "Score indisponible"} : voir le match`} title="Voir la fiche du match" className={`rounded-full px-2.5 py-1 text-sm font-bold transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-link ${result === "V" ? "bg-status-success text-status-success-foreground" : "bg-secondary text-foreground"}`}>{result}</Link>) : <p className="text-sm text-muted-foreground">Aucun résultat disponible.</p>}</div><p className="mt-2 text-xs text-muted-foreground">Le plus récent en premier.</p></div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Disponibilité</h2>{pulse.redCards.length ? <ul className="space-y-1 text-sm text-foreground">{pulse.redCards.map((card, i) => <li key={i}>{card.playerName} · carton rouge récent</li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun carton rouge renseigné sur 14 jours.</p>}<p className="mt-2 text-xs text-muted-foreground">Suspensions à confirmer. Données médicales indisponibles.</p></div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Mercato</h2>{pulse.mercato ? <Link href={`/article/${pulse.mercato.slug}`} className="text-sm font-semibold text-editorial-link hover:underline">{pulse.mercato.title}</Link> : <p className="text-sm text-muted-foreground">Aucune actualité Mercato disponible.</p>}</div>
  </section>;
}
