"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClubPulseData } from "@/lib/club-digest";

function countdown(date: string, now: number) {
  const totalHours = Math.max(0, Math.floor((new Date(date).getTime() - now) / 3600000));
  const days = Math.floor(totalHours / 24), hours = totalHours % 24;
  return days ? `Dans ${days} jour${days > 1 ? "s" : ""}${hours ? `, ${hours} h` : ""}` : totalHours ? `Dans ${totalHours} h` : "Dans moins d’une heure";
}
export function ClubPulse({ pulse }: { pulse: ClubPulseData }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const update = () => { if (!document.hidden) setNow(Date.now()); }; update(); const timer = setInterval(update, 60000); document.addEventListener("visibilitychange", update); return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); }; }, []);
  return <section aria-label="Pulse du club" className="my-6 grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-5">
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Prochain match</h2>{pulse.next ? <Link href={`/match/${pulse.next.id}`} className="text-sm text-foreground"><strong className="mb-1 block text-xl text-editorial-link">{now === null ? "À venir" : countdown(pulse.next.scheduledAt, now)}</strong>{pulse.next.home} – {pulse.next.away}<span className="mt-1 block text-xs text-muted-foreground">{new Date(pulse.next.scheduledAt).toLocaleString("fr-FR", { timeZone: "Africa/Lagos", dateStyle: "short", timeStyle: "short" })}</span></Link> : <p className="text-sm text-muted-foreground">Aucun match programmé.</p>}</div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Forme actuelle</h2><ClubForm form={pulse.form}/><p className="mt-2 text-xs text-muted-foreground">Le plus récent en premier.</p></div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Meilleur buteur</h2>{pulse.scorer ? <p className="text-sm text-foreground"><strong>{pulse.scorer.playerName}</strong><span className="mt-1 block text-xl font-bold text-editorial-link">{pulse.scorer.goals} but{pulse.scorer.goals > 1 ? "s" : ""}</span></p> : <p className="text-sm text-muted-foreground">Aucun buteur renseigné.</p>}<p className="mt-2 text-xs text-muted-foreground">Saison {pulse.seasonLabel} · depuis juillet</p></div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Disponibilité</h2>{pulse.redCards.length ? <ul className="space-y-1 text-sm text-foreground">{pulse.redCards.map((card, i) => <li key={i}>{card.playerName} · carton rouge récent</li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun carton rouge renseigné sur 14 jours.</p>}<p className="mt-2 text-xs text-muted-foreground">Suspensions à confirmer. Données médicales indisponibles.</p></div>
    <div><h2 className="mb-2 text-sm font-bold uppercase text-muted-foreground">Mercato</h2>{pulse.mercato ? <Link href={`/article/${pulse.mercato.slug}`} className="text-sm font-semibold text-editorial-link hover:underline">{pulse.mercato.title}</Link> : <p className="text-sm text-muted-foreground">Aucune actualité Mercato disponible.</p>}</div>
  </section>;
}

export function ClubForm({ form, centered = false, compact = false }: { form: ClubPulseData["form"]; centered?: boolean; compact?: boolean }) {
  return <div style={compact ? { flexWrap: "nowrap" } : undefined} className={`flex flex-wrap gap-1 ${centered ? "justify-center" : ""}`} aria-label="Résultats du plus récent au plus ancien">{form.length ? form.map(({ matchId, result, opponent, scheduledAt }) => { const outcome = result === "V" ? "Victoire" : result === "N" ? "Match nul" : result === "D" ? "Défaite" : "Score indisponible"; const tooltip = `${outcome} contre ${opponent} — ${new Date(scheduledAt).toLocaleDateString("fr-FR", { timeZone: "Africa/Lagos", day: "numeric", month: "long", year: "numeric" })}`; return <Link key={matchId} href={`/match/${matchId}`} aria-label={`${tooltip} : voir le match`} title={tooltip} style={compact ? { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, minWidth: 22, padding: 0, borderRadius: "50%", fontSize: 11 } : undefined} className={`rounded-full px-2.5 py-1 text-sm font-bold transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-link ${result === "V" ? "bg-status-success text-status-success-foreground" : result === "D" ? "bg-status-error text-status-error-foreground" : result === "N" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300" : "bg-secondary text-foreground"}`}>{result}</Link>; }) : <p className="text-sm text-muted-foreground">Aucun résultat disponible.</p>}</div>;
}
