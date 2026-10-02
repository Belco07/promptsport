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
  pending: "bg-gray-100 text-gray-600",
  running: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
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
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Synchronisation en cours…" : "Tout synchroniser"}
        </button>
        <span className="text-xs text-gray-500">
          {DEFAULT_COMPETITIONS.length} compétitions · ~6 s entre chaque requête API
        </span>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">
          Progression
        </h2>
        <ul className="divide-y divide-gray-100">
          {rows.map((row) => (
            <li key={row.code} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {row.label}{" "}
                  <span className="text-xs font-normal text-gray-400">({row.code})</span>
                </p>
                {row.detail ? (
                  <p className="mt-0.5 text-xs text-gray-500">{row.detail}</p>
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
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {summary}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <p className="font-medium">Erreurs rencontrées :</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">
          Synchroniser une seule compétition
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={singleCode}
            onChange={(event) => setSingleCode(event.target.value)}
            disabled={isPending}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60"
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
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 disabled:opacity-60"
          >
            Synchroniser cette compétition
          </button>
        </div>
      </div>
    </div>
  );
}
