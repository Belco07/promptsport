"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DEFAULT_COMPETITIONS, competitionLabel } from "@/lib/sports";

import { syncOneCompetition } from "../actions";

type RowStatus = "pending" | "running" | "done" | "error";

type Row = {
  code: string;
  label: string;
  status: RowStatus;
  detail?: string;
};

const STATUS_STYLES: Record<RowStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-status-info text-editorial-link",
  done: "bg-status-success text-status-success-foreground",
  error: "bg-status-error text-status-error-foreground",
};

const STATUS_LABELS: Record<RowStatus, string> = {
  pending: "En attente",
  running: "En cours",
  done: "Terminé",
  error: "Erreur",
};

function initialRows(): Row[] {
  return DEFAULT_COMPETITIONS.map((code) => ({
    code,
    label: competitionLabel(code),
    status: "pending" as RowStatus,
  }));
}

/**
 * Synchronisation des compétitions depuis Football-Data.org.
 *
 * Le bouton principal enchaîne les compétitions une par une côté client : cela
 * permet d'afficher une progression réelle par compétition (une Server Action
 * globale ne renverrait le résumé qu'à la toute fin). Chaque appel serveur
 * respecte le rate limiting de l'API (6 s entre requêtes).
 */
export function SyncForm() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows());
  const [summary, setSummary] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [singleCode, setSingleCode] = useState<string>(DEFAULT_COMPETITIONS[0]);
  const [isPending, startTransition] = useTransition();

  function updateRow(code: string, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.code === code ? { ...row, ...patch } : row)),
    );
  }

  function runAll() {
    setSummary(null);
    setErrors([]);
    setRows(initialRows());

    startTransition(async () => {
      let teams = 0;
      let matches = 0;
      let done = 0;
      const collected: string[] = [];

      for (const code of DEFAULT_COMPETITIONS) {
        updateRow(code, { status: "running" });
        const result = await syncOneCompetition(code);

        if (result.ok) {
          updateRow(code, {
            status: "done",
            detail: `${result.teams} équipe(s), ${result.matches} match(s)`,
          });
          teams += result.teams;
          matches += result.matches;
          done += 1;
        } else {
          updateRow(code, { status: "error", detail: result.error });
          collected.push(`${competitionLabel(code)} : ${result.error}`);
        }
      }

      setSummary(
        `${done} compétition(s), ${teams} équipe(s), ${matches} match(s) synchronisés.`,
      );
      setErrors(collected);
      router.refresh();
    });
  }

  function runOne() {
    setSummary(null);
    setErrors([]);
    updateRow(singleCode, { status: "running" });

    startTransition(async () => {
      const result = await syncOneCompetition(singleCode);
      if (result.ok) {
        updateRow(singleCode, {
          status: "done",
          detail: `${result.teams} équipe(s), ${result.matches} match(s)`,
        });
        setSummary(
          `${result.name} : ${result.teams} équipe(s), ${result.matches} match(s) synchronisés.`,
        );
      } else {
        updateRow(singleCode, { status: "error", detail: result.error });
        setErrors([`${competitionLabel(singleCode)} : ${result.error}`]);
      }
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runAll}
          disabled={isPending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Synchronisation en cours…" : "Tout synchroniser"}
        </button>
        <span className="text-xs text-muted-foreground">
          {DEFAULT_COMPETITIONS.length} compétitions · ~6 s entre chaque requête API
        </span>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
          Progression
        </h2>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.code} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {row.label}{" "}
                  <span className="text-xs font-normal text-muted-foreground">({row.code})</span>
                </p>
                {row.detail ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{row.detail}</p>
                ) : null}
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
              >
                {STATUS_LABELS[row.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {summary ? (
        <p className="rounded-md border border-status-success-border bg-status-success px-3 py-2 text-sm text-status-success-foreground">
          {summary}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground"
        >
          <p className="font-medium">Erreurs rencontrées :</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">
          Synchroniser une seule compétition
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={singleCode}
            onChange={(event) => setSingleCode(event.target.value)}
            disabled={isPending}
            className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground disabled:opacity-60"
          >
            {DEFAULT_COMPETITIONS.map((code) => (
              <option key={code} value={code}>
                {competitionLabel(code)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={runOne}
            disabled={isPending}
            className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            Synchroniser cette compétition
          </button>
        </div>
      </div>
    </div>
  );
}
