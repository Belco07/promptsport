"use client";
import Link from "next/link";
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


type Alert = { id: string; title: string; titleFr: string | null; content: string | null; url: string; publishedAt: string; status: keyof typeof STATUS_STYLES; source: { name: string; type: string; isOfficial: boolean } };
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
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Alertes de veille éditoriale</caption>
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3"><input type="checkbox" aria-label="Sélectionner toutes les alertes en attente" disabled={busy || !pending.length} checked={pending.length > 0 && pending.every(alert => selected.includes(alert.id))} onChange={event => setSelected(event.target.checked ? pending.map(alert => alert.id) : [])} /></th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Alerte
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Source
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Statut
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {alerts.map((alert) => {
                const status = STATUS_STYLES[alert.status];
                const displayTitle = alert.titleFr ?? alert.title;
                return (
                  <tr key={alert.id} className="align-top hover:bg-muted">
                    <td className="px-4 py-3">{alert.status === "PENDING" && !completed.includes(alert.id) && <input type="checkbox" aria-label={`Sélectionner ${displayTitle}`} checked={selected.includes(alert.id)} disabled={busy} onChange={() => toggle(alert.id)} />}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      <time dateTime={alert.publishedAt}>
                        {dateFormatter.format(new Date(alert.publishedAt))}
                      </time>
                    </td>
                    <td className="max-w-xl px-4 py-3">
                      <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={
                          displayTitle !== alert.title
                            ? `Titre original : ${alert.title}`
                            : undefined
                        }
                        className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-editorial-link"
                      >
                        {displayTitle}
                      </a>
                      {alert.content ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {alert.content}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{alert.source.name}</span>
                        {alert.source.isOfficial ? (
                          <span className="inline-flex rounded bg-status-success px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-success-foreground">
                            Officiel
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-muted-foreground">
                        {SOURCE_TYPE_LABELS[alert.source.type] ?? alert.source.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {alert.status === "PENDING" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" disabled={busy || !aiReady || completed.includes(alert.id)} onClick={() => run([alert.id], "generate")} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50">Générer avec l’IA</button>
                          <button type="button" disabled={busy || completed.includes(alert.id)} onClick={() => run([alert.id], "ignore")} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50">Ignorer et supprimer</button>
                        </div>
                      ) : alert.status === "DRAFT_GENERATED" ? (
                        <Link
                          href="/studio/articles"
                          className="text-xs font-medium text-editorial-link underline hover:text-editorial-link"
                        >
                          Retrouver le brouillon
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
  </div>;
}
