import type { MatchStatistics } from "@/generated/prisma/client";
const fields = { possession: "Possession", shots: "Tirs", shotsOnTarget: "Tirs cadrés", corners: "Corners", fouls: "Fautes", yellowCards: "Cartons jaunes", redCards: "Cartons rouges" } as const;
export function MatchStats({ statistics, homeTeamId, homeName, awayName }: { statistics: MatchStatistics[]; homeTeamId: string; homeName: string; awayName: string }) {
  const home = statistics.find(row => row.teamId === homeTeamId), away = statistics.find(row => row.teamId !== homeTeamId);
  if (!statistics.length) return <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">Disponible prochainement</p>;
  return <div className="rounded-xl border border-border bg-card p-5 md:p-8"><div className="mb-7 flex justify-between gap-4 font-bold text-foreground"><span>{homeName}</span><span className="text-right">{awayName}</span></div><dl className="space-y-6">{Object.entries(fields).map(([key, label]) => {
    const field = key as keyof typeof fields, h = home?.[field] ?? null, a = away?.[field] ?? null, total = (h ?? 0) + (a ?? 0);
    return <div key={key}><div className="mb-2 flex justify-between gap-3 text-sm"><dd className="font-bold tabular-nums text-foreground">{h ?? "—"}{h !== null && key === "possession" ? "%" : ""}</dd><dt className="text-muted-foreground">{label}</dt><dd className="font-bold tabular-nums text-foreground">{a ?? "—"}{a !== null && key === "possession" ? "%" : ""}</dd></div><div aria-hidden="true" className="flex h-2 gap-1 overflow-hidden rounded-full bg-muted"><div className="rounded-full bg-editorial-link" style={{ width: `${total ? (h ?? 0) / total * 100 : 0}%` }}/><div className="rounded-full bg-status-danger" style={{ width: `${total ? (a ?? 0) / total * 100 : 0}%` }}/></div></div>;
  })}</dl></div>;
}
