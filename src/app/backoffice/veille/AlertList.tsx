/* eslint-disable @next/next/no-img-element -- vignettes de veille distantes, tailles fixes */
"use client";
import Link from "next/link";
import { TimelineBadge, type TimelineCategory } from "@/components/TimelineBadge";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { generateArticle, ignoreSelectedAlert, markAlertsViral } from "./actions";
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

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Lagos",
});

type Alert = {
  id: string;
  title: string;
  titleFr: string | null;
  content: string | null;
  url: string;
  publishedAt: string;
  status: keyof typeof STATUS_STYLES;
  viralScore?: number | null;
  category?: TimelineCategory | null;
  imageUrl?: string | null;
  imageCredit?: string | null;
  source: {
    name: string;
    type: string;
    isOfficial: boolean;
    imagePolicy: "REFERENCE_ONLY" | "LICENSED";
  };
};

type VeilleView = "table" | "timeline";

/**
 * Veille éditoriale (WP41, WP47, WP49).
 *
 * Deux lectures des mêmes alertes : un tableau dense avec toutes les colonnes
 * de décision, et la timeline historique conservée à l'identique. La génération
 * IA est ouverte à toutes les alertes ; le score 5 🔥 ne conditionne plus que
 * la publication automatique, côté serveur.
 */
export function AlertList({ alerts, aiReady, aiQuotaRemaining }: { alerts: Alert[]; aiReady: boolean; aiQuotaRemaining: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [view, setView] = useState<VeilleView>("table");
  // Marqueur d'hydratation : les E2E attendent que les boutons d'action soient
  // réellement interactifs avant de cliquer (les clics pré-hydratation sont
  // silencieusement ignorés par React).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
    try {
      const stored = window.localStorage.getItem("veille:view");
      if (stored === "table" || stored === "timeline") setView(stored);
    } catch {
      // Stockage indisponible : la vue par défaut reste le tableau.
    }
  }, []);
  const pending = alerts.filter(alert => alert.status === "PENDING" && !completed.includes(alert.id));
  const selectedPending = selected.filter(id => pending.some(alert => alert.id === id));
  const generationDisabled = busy || !aiReady || aiQuotaRemaining <= 0;
  function toggle(id: string) { setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]); }
  function changeView(next: VeilleView) {
    setView(next);
    try { window.localStorage.setItem("veille:view", next); } catch { /* vue en mémoire seulement */ }
  }
  function scoreOf(alert: Alert): number | null {
    return typeof alert.viralScore === "number" && alert.viralScore >= 1 && alert.viralScore <= 5
      ? Math.floor(alert.viralScore)
      : null;
  }
  async function run(ids: string[], kind: "generate" | "ignore") {
    if (busy || !ids.length) return;
    if (kind === "ignore" && !window.confirm("Supprimer définitivement les alertes sélectionnées ?")) return;
    setBusy(true); setErrors([]); let success = 0; let autoPublished = 0; let photoBlocked = 0; const failures: string[] = [];
    try {
      for (let index = 0; index < ids.length; index++) {
        setMessage("Traitement " + (index + 1) + "/" + ids.length + "…");
        try {
          const result = await (kind === "generate" ? generateArticle(ids[index]) : ignoreSelectedAlert(ids[index]));
          if (result.success) {
            success++;
            if (result.published) autoPublished++;
            if (result.photoBlocked) photoBlocked++;
            setCompleted(values => [...values, ids[index]]);
            setSelected(values => values.filter(id => id !== ids[index]));
          }
          else failures.push((alerts.find(alert => alert.id === ids[index])?.title ?? "Alerte") + " : " + result.message);
        } catch { failures.push("Connexion interrompue : vérifiez le statut avant de réessayer."); }
      }
      if (kind === "generate") {
        const draftCount = success - autoPublished;
        const parts: string[] = [];
        if (draftCount > 0) parts.push(draftCount + " brouillon(s) généré(s).");
        if (autoPublished > 0) parts.push(autoPublished + " article(s) publié(s) automatiquement.");
        if (photoBlocked > 0) parts.push(photoBlocked + " brouillon(s) sans photo source exploitable : publication automatique impossible.");
        setMessage(parts.join(" ") || "Aucun article généré.");
      } else {
        setMessage(success + " alerte(s) ignorée(s).");
      }
      setErrors(failures);
    } finally { setBusy(false); router.refresh(); }
  }
  async function markSelectedViral() {
    if (busy || !selected.length) return;
    setBusy(true); setErrors([]);
    try {
      const result = await markAlertsViral(selected);
      setMessage(result.message);
      if (result.success) setSelected([]);
      else setErrors([result.message]);
    } catch {
      setErrors(["Connexion interrompue : le marquage n'a pas été confirmé."]);
    } finally { setBusy(false); router.refresh(); }
  }

  /** Boutons de décision communs au tableau et à la timeline. */
  function alertActions(alert: Alert) {
    const done = completed.includes(alert.id);
    if (alert.status === "PENDING") {
      return <>
        <button type="button" disabled={generationDisabled || done} title={!aiReady ? "DEEPSEEK_API_KEY manquante" : aiQuotaRemaining <= 0 ? "Quota IA atteint pour aujourd'hui" : "Générer un article à partir de cette alerte"} onClick={() => run([alert.id], "generate")} className="min-h-9 rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">Générer avec l’IA</button>
        <button type="button" disabled={busy || done} onClick={() => run([alert.id], "ignore")} className="min-h-9 rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">Ignorer et supprimer</button>
      </>;
    }
    if (alert.status === "DRAFT_GENERATED") {
      return <Link href="/studio/articles" className="text-xs font-medium text-editorial-link underline">Retrouver le brouillon</Link>;
    }
    return null;
  }

  function scoreBadge(alert: Alert) {
    const score = scoreOf(alert);
    return <span aria-label={score ? `Viralité ${score} sur 5` : "Viralité non évaluée"} title="Estimation éditoriale, sans mesure des partages sociaux" className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs font-semibold text-foreground"><span aria-hidden="true">{score ? "🔥".repeat(score) : "—"}</span>{score ? `${score}/5` : "Non évaluée"}</span>;
  }

  function statusBadge(alert: Alert) {
    const status = STATUS_STYLES[alert.status];
    return <span className={`rounded px-2 py-1 ${status.className}`}>{status.label}</span>;
  }

  function visualCell(alert: Alert) {
    return <div className="flex items-center gap-2">
      {alert.imageUrl
        ? <img src={alert.imageUrl} alt="" width={64} height={40} loading="lazy" className="h-10 w-16 shrink-0 rounded object-cover" />
        : <span aria-hidden="true" className="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">Aucun</span>}
      <div className="min-w-0 text-xs">
        <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${alert.source.imagePolicy === "LICENSED" ? "bg-status-success text-status-success-foreground" : "bg-muted text-muted-foreground"}`}>
          {alert.source.imagePolicy === "LICENSED" ? "Licence" : "Référence"}
        </span>
        {alert.imageCredit ? <p className="mt-1 truncate text-muted-foreground" title={alert.imageCredit}>Crédit : {alert.imageCredit}</p> : null}
        {!alert.imageUrl ? <p className="mt-1 text-muted-foreground">Pas de visuel</p> : null}
      </div>
    </div>;
  }

  return <div aria-busy={busy} data-veille-ready={hydrated ? "true" : undefined}>
    <p role="status" aria-live="polite" className="mb-3 text-sm text-foreground">{message}</p>
    {aiQuotaRemaining <= 0 ? <div className="mb-3 rounded-lg border border-status-warning-border bg-status-warning px-4 py-3 text-sm text-status-warning-foreground">Quota IA atteint pour aujourd&apos;hui. La génération reprendra demain.</div> : null}
    {errors.length > 0 && <div role="alert" className="mb-3 text-status-error-foreground"><p>Certains traitements ont échoué :</p><ul>{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}
    {selected.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
      <span>{selected.length} alerte(s) sélectionnée(s)</span>
      <button type="button" disabled={generationDisabled || selectedPending.length === 0} title={selectedPending.length === 0 ? "Sélectionnez au moins une alerte en attente" : aiQuotaRemaining <= 0 ? "Quota IA atteint pour aujourd'hui" : undefined} onClick={() => run(selectedPending, "generate")} className="rounded border border-border px-3 py-2 disabled:opacity-50">Générer les alertes sélectionnées</button>
      <button type="button" disabled={busy} onClick={markSelectedViral} className="rounded border border-border px-3 py-2 disabled:opacity-50">Marquer 5 🔥</button>
      <button type="button" disabled={busy} onClick={() => run(selected, "ignore")} className="rounded border border-border px-3 py-2 disabled:opacity-50">Ignorer les alertes sélectionnées</button>
    </div>}

    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-3 text-xs font-semibold text-muted-foreground"><input type="checkbox" aria-label="Sélectionner toutes les alertes en attente" disabled={busy || !pending.length} checked={pending.length > 0 && pending.every(alert => selected.includes(alert.id))} onChange={event => setSelected(event.target.checked ? pending.map(alert => alert.id) : [])} />Sélectionner toutes les alertes en attente</label>
      <div role="group" aria-label="Affichage des alertes" className="inline-flex overflow-hidden rounded-md border border-border text-xs font-medium">
        <button type="button" aria-pressed={view === "table"} onClick={() => changeView("table")} className={`px-3 py-2 ${view === "table" ? "bg-primary text-white" : "bg-card text-foreground hover:bg-muted"}`}>Tableau</button>
        <button type="button" aria-pressed={view === "timeline"} onClick={() => changeView("timeline")} className={`px-3 py-2 ${view === "timeline" ? "bg-primary text-white" : "bg-card text-foreground hover:bg-muted"}`}>Timeline</button>
      </div>
    </div>

    {view === "table" ? (
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
          <caption className="sr-only">Alertes de veille éditoriale, vue tableau</caption>
          <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold"><span className="sr-only">Sélection</span></th>
              <th scope="col" className="px-3 py-3 font-semibold">Date / heure</th>
              <th scope="col" className="px-3 py-3 font-semibold">Titre</th>
              <th scope="col" className="px-3 py-3 font-semibold">Source</th>
              <th scope="col" className="px-3 py-3 font-semibold">Catégorie</th>
              <th scope="col" className="px-3 py-3 font-semibold">Score</th>
              <th scope="col" className="px-3 py-3 font-semibold">Statut</th>
              <th scope="col" className="px-3 py-3 font-semibold">Visuel / licence</th>
              <th scope="col" className="px-3 py-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map(alert => {
              const displayTitle = alert.titleFr ?? alert.title;
              return <tr key={alert.id} data-alert-id={alert.id} className="border-b border-border align-top last:border-b-0">
                <td className="px-3 py-4">
                  {alert.status === "PENDING" && !completed.includes(alert.id)
                    ? <input type="checkbox" aria-label={`Sélectionner ${displayTitle}`} checked={selected.includes(alert.id)} disabled={busy} onChange={() => toggle(alert.id)} />
                    : <span aria-hidden="true" className="text-muted-foreground">—</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-4 text-xs tabular-nums text-muted-foreground">
                  <time dateTime={alert.publishedAt} title={dateFormatter.format(new Date(alert.publishedAt))}>{timeFormatter.format(new Date(alert.publishedAt))}</time>
                  <span className="mt-1 block text-[11px]">{new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(new Date(alert.publishedAt))}</span>
                </td>
                <td className="max-w-[24rem] px-3 py-4">
                  <a href={alert.url} target="_blank" rel="noopener noreferrer" className="font-semibold leading-snug text-foreground underline-offset-4 hover:underline" title={displayTitle !== alert.title ? `Titre original : ${alert.title}` : undefined}>{displayTitle}</a>
                  {displayTitle !== alert.title ? <p className="mt-1 line-clamp-1 text-[11px] italic text-muted-foreground" title={alert.title}>{alert.title}</p> : null}
                  {alert.content ? <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{alert.content}</p> : null}
                </td>
                <td className="px-3 py-4 text-xs">
                  <span className="block font-medium text-foreground">{alert.source.name}</span>
                  <span className="text-muted-foreground">{SOURCE_TYPE_LABELS[alert.source.type] ?? alert.source.type}</span>
                  {alert.source.isOfficial && <span className="mt-1 block w-fit rounded bg-status-success px-2 py-0.5 font-semibold text-status-success-foreground">Officiel</span>}
                </td>
                <td className="px-3 py-4"><TimelineBadge category={alert.category} /></td>
                <td className="whitespace-nowrap px-3 py-4">{scoreBadge(alert)}</td>
                <td className="whitespace-nowrap px-3 py-4 text-xs">{statusBadge(alert)}</td>
                <td className="px-3 py-4">{visualCell(alert)}</td>
                <td className="px-3 py-4"><div className="flex flex-col items-start gap-2">{alertActions(alert)}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
        <ol aria-label="Alertes de veille éditoriale" className="ml-1 border-l border-border">
          {alerts.map(alert => {
            const displayTitle = alert.titleFr ?? alert.title;
            return <li key={alert.id} data-alert-id={alert.id} className="relative min-w-0 border-b border-border pb-5 pl-5 pt-5 first:pt-0 last:border-b-0 last:pb-0">
              <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
                <span aria-hidden="true" className="absolute -left-6 top-2 h-2 w-2 rounded-full border border-border bg-card" />
                {alert.status === "PENDING" && !completed.includes(alert.id) && <input type="checkbox" aria-label={`Sélectionner ${displayTitle}`} checked={selected.includes(alert.id)} disabled={busy} onChange={() => toggle(alert.id)} />}
                <time dateTime={alert.publishedAt} title={dateFormatter.format(new Date(alert.publishedAt))} className="text-xs tabular-nums text-muted-foreground">{timeFormatter.format(new Date(alert.publishedAt))}</time>
                <TimelineBadge category={alert.category} />
                <h2 className="order-last basis-full text-base font-semibold leading-snug text-foreground sm:order-none sm:flex-1 sm:basis-0"><a href={alert.url} target="_blank" rel="noopener noreferrer" title={displayTitle !== alert.title ? `Titre original : ${alert.title}` : undefined} className="underline-offset-4 hover:underline">{displayTitle}</a></h2>
                <span className="sm:ml-auto">{scoreBadge(alert)}</span>
              </div>
              {alert.content && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{alert.content}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{alert.source.name}</span><span>{SOURCE_TYPE_LABELS[alert.source.type] ?? alert.source.type}</span>{alert.source.isOfficial && <span className="rounded bg-status-success px-2 py-0.5 font-semibold text-status-success-foreground">Officiel</span>}{statusBadge(alert)}{alert.imageUrl ? <span>Visuel : {alert.source.imagePolicy === "LICENSED" ? "licence" : "référence"}{alert.imageCredit ? ` — ${alert.imageCredit}` : ""}</span> : <span>Pas de visuel</span>}</div>
              <div className="mt-3 flex flex-wrap gap-2">{alertActions(alert)}</div>
            </li>;
          })}
        </ol>
      </div>
    )}
  </div>;
}
