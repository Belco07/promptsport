"use client";
import Link from "next/link";
import { TimelineBadge, type TimelineCategory } from "@/components/TimelineBadge";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateArticle, ignoreSelectedAlert } from "./actions";
const STATUS_STYLES = {
  PENDING: {
    label: "En attente",
    className: "bg-status-warning text-status-warning-foreground",
  },
  DRAFT_GENERATED: {
    label: "Brouillon généré",
    className: "bg-status-success text-status-success-foreground",
  },
  IGNORED: {
    label: "Ignorée",
    className: "bg-muted text-muted-foreground",
  },
} as const;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  RSS: "Flux RSS",
  YOUTUBE: "YouTube",
  BLUESKY: "Bluesky",
  MASTODON: "Mastodon",
  REDDIT: "Reddit",
  X: "X (Twitter)",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  SOCIAL: "Réseau social (RSS)",
  FLASHSCORE: "Flashscore",
  SITEMAP: "Sitemap d'actualités",
  OFFICIAL_SITE: "Site officiel",
  JSON: "API JSON",
  MANUAL: "Site officiel (référence)",
};

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});


type Alert = { id: string; title: string; titleFr: string | null; content: string | null; url: string; publishedAt: string; status: keyof typeof STATUS_STYLES; viralScore?: number | null; category?: TimelineCategory | null; source: { name: string; type: string; isOfficial: boolean } };
export function AlertList({ alerts, aiReady }: { alerts: Alert[]; aiReady: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const pending = alerts.filter(alert => alert.status === "PENDING" && !completed.includes(alert.id));
  function toggle(id: string) { setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]); }
  async function run(ids: string[], kind: "generate" | "ignore") {
    if (busy || !ids.length) return;
    if (kind === "ignore" && !window.confirm("Supprimer définitivement les alertes sélectionnées ?")) return;
    setBusy(true); setErrors([]); let success = 0; const failures: string[] = [];
    try {
      for (let index = 0; index < ids.length; index++) {
        setMessage("Traitement " + (index + 1) + "/" + ids.length + "…");
        try {
          const result = await (kind === "generate" ? generateArticle(ids[index]) : ignoreSelectedAlert(ids[index]));
          if (result.success) { success++; setCompleted(values => [...values, ids[index]]); setSelected(values => values.filter(id => id !== ids[index])); }
          else failures.push((alerts.find(alert => alert.id === ids[index])?.title ?? "Alerte") + " : " + result.message);
        } catch { failures.push("Connexion interrompue : vérifiez le statut avant de réessayer."); }
      }
      setMessage(kind === "generate" ? success + " brouillon(s) généré(s)." : success + " alerte(s) ignorée(s).");
      setErrors(failures);
    } finally { setBusy(false); router.refresh(); }
  }
  return <div aria-busy={busy}>
    <p role="status" aria-live="polite" className="mb-3 text-sm text-foreground">{message}</p>
    {errors.length > 0 && <div role="alert" className="mb-3 text-status-error-foreground"><p>Certains traitements ont échoué :</p><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
    {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
      <span>{selected.length} alerte(s) sélectionnée(s)</span>
      <button type="button" disabled={busy || !aiReady} onClick={() => run(selected, "generate")} className="rounded border border-border px-3 py-2 disabled:opacity-50">Générer les brouillons sélectionnés</button>
      <button type="button" disabled={busy} onClick={() => run(selected, "ignore")} className="rounded border border-border px-3 py-2 disabled:opacity-50">Ignorer les alertes sélectionnées</button>
    </div>}
    <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
      <label className="mb-5 flex items-center gap-3 text-xs font-semibold text-muted-foreground"><input type="checkbox" aria-label="Sélectionner toutes les alertes en attente" disabled={busy || !pending.length} checked={pending.length > 0 && pending.every(alert => selected.includes(alert.id))} onChange={event => setSelected(event.target.checked ? pending.map(alert => alert.id) : [])} />Sélectionner toutes les alertes en attente</label>
      <ol aria-label="Alertes de veille éditoriale" className="ml-1 border-l border-border">
        {alerts.map(alert => {
          const status = STATUS_STYLES[alert.status];
          const displayTitle = alert.titleFr ?? alert.title;
          const score = typeof alert.viralScore === "number" && alert.viralScore >= 1 && alert.viralScore <= 5 ? Math.floor(alert.viralScore) : null;
          return <li key={alert.id} data-alert-id={alert.id} className="relative min-w-0 border-b border-border pb-5 pl-5 pt-5 first:pt-0 last:border-b-0 last:pb-0">
            <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
              <span aria-hidden="true" className="absolute -left-6 top-2 h-2 w-2 rounded-full border border-border bg-card" />
              {alert.status === "PENDING" && !completed.includes(alert.id) && <input type="checkbox" aria-label={`Sélectionner ${displayTitle}`} checked={selected.includes(alert.id)} disabled={busy} onChange={() => toggle(alert.id)} />}
              <time dateTime={alert.publishedAt} title={dateFormatter.format(new Date(alert.publishedAt))} className="text-xs tabular-nums text-muted-foreground">{new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }).format(new Date(alert.publishedAt))}</time>
              <TimelineBadge category={alert.category} />
            <h2 className="order-last basis-full text-base font-semibold leading-snug text-foreground sm:order-none sm:flex-1 sm:basis-0"><a href={alert.url} target="_blank" rel="noopener noreferrer" title={displayTitle !== alert.title ? `Titre original : ${alert.title}` : undefined} className="underline-offset-4 hover:underline">{displayTitle}</a></h2>
              <span aria-label={score ? `Viralité ${score} sur 5` : "Viralité non évaluée"} title="Estimation éditoriale, sans mesure des partages sociaux" className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs font-semibold text-foreground sm:ml-auto"><span aria-hidden="true">{score ? "🔥".repeat(score) : "—"}</span>{score ? `${score}/5` : "Non évaluée"}</span>
            </div>
            {alert.content && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{alert.content}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{alert.source.name}</span><span>{SOURCE_TYPE_LABELS[alert.source.type] ?? alert.source.type}</span>{alert.source.isOfficial && <span className="rounded bg-status-success px-2 py-0.5 font-semibold text-status-success-foreground">Officiel</span>}<span className={`rounded px-2 py-1 ${status.className}`}>{status.label}</span></div>
            <div className="mt-3 flex flex-wrap gap-2">{alert.status === "PENDING" ? <><button type="button" disabled={busy || !aiReady || completed.includes(alert.id)} onClick={() => run([alert.id], "generate")} className="min-h-10 rounded border border-border px-3 py-2 text-xs disabled:opacity-50">Générer avec l’IA</button><button type="button" disabled={busy || completed.includes(alert.id)} onClick={() => run([alert.id], "ignore")} className="min-h-10 rounded border border-border px-3 py-2 text-xs disabled:opacity-50">Ignorer et supprimer</button></> : alert.status === "DRAFT_GENERATED" ? <Link href="/studio/articles" className="text-xs font-medium text-editorial-link underline">Retrouver le brouillon</Link> : null}</div>
          </li>;
        })}
      </ol>
    </div>
  </div>;
}
