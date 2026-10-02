"use client";

import Link from "next/link";
import { useActionState } from "react";

import { MATCH_STATUS_LABELS, type MatchStatus } from "@/components/MatchCard";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

const STATUSES = Object.keys(MATCH_STATUS_LABELS) as MatchStatus[];

type CompetitionOption = { id: string; name: string };
type TeamOption = { id: string; name: string };

type Props = {
  action: (prev: string | undefined, formData: FormData) => Promise<string | undefined>;
  competitions: CompetitionOption[];
  teams: TeamOption[];
  defaultValues?: {
    competitionId: string;
    homeTeamId: string;
    awayTeamId: string;
    scheduledAt: string;
    status: MatchStatus;
    homeScore: string;
    awayScore: string;
    venue: string;
  };
  submitLabel: string;
};

function toDateTimeLocal(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MatchForm({ action, competitions, teams, defaultValues, submitLabel }: Props) {
  const [errorMessage, formAction, isPending] = useActionState(action, undefined);
  const initial = {
    competitionId: "",
    homeTeamId: "",
    awayTeamId: "",
    scheduledAt: "",
    status: "SCHEDULED" as MatchStatus,
    homeScore: "",
    awayScore: "",
    venue: "",
    ...defaultValues,
  };

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div>
        <label htmlFor="competitionId" className={labelClass}>Compétition</label>
        <select id="competitionId" name="competitionId" required defaultValue={initial.competitionId} className={inputClass}>
          <option value="">— Choisir —</option>
          {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="homeTeamId" className={labelClass}>Équipe domicile</label>
          <select id="homeTeamId" name="homeTeamId" required defaultValue={initial.homeTeamId} className={inputClass}>
            <option value="">— Choisir —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="awayTeamId" className={labelClass}>Équipe extérieur</label>
          <select id="awayTeamId" name="awayTeamId" required defaultValue={initial.awayTeamId} className={inputClass}>
            <option value="">— Choisir —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="scheduledAt" className={labelClass}>Date / heure</label>
        <input
          id="scheduledAt" name="scheduledAt" type="datetime-local" required
          defaultValue={initial.scheduledAt ? toDateTimeLocal(initial.scheduledAt) : ""}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="status" className={labelClass}>Statut</label>
        <select id="status" name="status" defaultValue={initial.status} className={inputClass}>
          {STATUSES.map((s) => <option key={s} value={s}>{MATCH_STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="homeScore" className={labelClass}>Score domicile</label>
          <input id="homeScore" name="homeScore" type="number" min={0} defaultValue={initial.homeScore} className={inputClass} />
        </div>
        <div>
          <label htmlFor="awayScore" className={labelClass}>Score extérieur</label>
          <input id="awayScore" name="awayScore" type="number" min={0} defaultValue={initial.awayScore} className={inputClass} />
        </div>
      </div>

      <div>
        <label htmlFor="venue" className={labelClass}>Lieu</label>
        <input id="venue" name="venue" type="text" defaultValue={initial.venue} className={inputClass} />
      </div>

      {errorMessage ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={isPending} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60">
          {isPending ? "Enregistrement…" : submitLabel}
        </button>
        <Link href="/backoffice/sports/matches" className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100">
          Annuler
        </Link>
      </div>
    </form>
  );
}
