import Link from "next/link";
import type { RivalryData } from "@/lib/club-digest";

export function RivalryBlock({ rivalries }: { rivalries: RivalryData[] }) {
  if (!rivalries.length) return <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Aucun rival renseigné pour ce club.</p>;
  return <div className="space-y-5">{rivalries.map(rival => <section key={rival.slug} className="rounded-xl border border-border bg-card p-5"><h3 className="text-xl font-bold"><Link href={`/club/${rival.slug}`} className="text-editorial-link">{rival.name}</Link></h3>
    <p className="mt-3 text-sm text-foreground">Bilan des confrontations renseignées : <strong>{rival.record.won} victoire{rival.record.won > 1 ? "s" : ""}</strong> · {rival.record.drawn} nul{rival.record.drawn > 1 ? "s" : ""} · {rival.record.lost} défaite{rival.record.lost > 1 ? "s" : ""}.</p>
    {rival.derby ? <p className="my-4 rounded-lg bg-secondary p-4 font-semibold text-foreground">Prochain derby : <Link href={`/match/${rival.derby.id}`} className="text-editorial-link underline">{rival.derby.home} – {rival.derby.away}, le {new Date(rival.derby.scheduledAt).toLocaleString("fr-FR", {timeZone:"Africa/Lagos", dateStyle:"long", timeStyle:"short"})}</Link></p> : <p className="mt-3 text-sm text-muted-foreground">Aucun prochain derby programmé.</p>}
    <h4 className="mb-2 mt-4 text-sm font-bold text-foreground">Dernières confrontations</h4>{rival.fixtures.length ? <ul className="space-y-2">{rival.fixtures.map(match => <li key={match.id}><Link href={`/match/${match.id}`} className="inline-block min-h-11 py-2 text-sm text-foreground hover:underline">{new Date(match.scheduledAt).toLocaleDateString("fr-FR", {timeZone:"Africa/Lagos"})} · {match.home} {match.homeScore ?? "—"} – {match.awayScore ?? "—"} {match.away}</Link></li>)}</ul> : <p className="text-sm text-muted-foreground">Aucune confrontation enregistrée.</p>}
  </section>)}</div>;
}
