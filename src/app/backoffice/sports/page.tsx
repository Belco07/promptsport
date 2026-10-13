import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatRelativeDate } from "@/lib/formatDate";
import { SportTabs } from "@/components/SportTabs";

/**
 * État de la synchronisation et accès aux onglets de gestion existants.
 */
export const dynamic = "force-dynamic";

export default async function SportsPage() {
  const types = ["live", "upcoming", "finished"] as const;
  const labels = { live: "Direct", upcoming: "Matchs à venir", finished: "Résultats" };
  const [logs, updates, liveCount] = await Promise.all([
    Promise.all(types.map(type => prisma.syncLog.findFirst({ where: { type }, orderBy: { startedAt: "desc" } }))),
    Promise.all(types.map(type => prisma.syncLog.findFirst({ where: { type, matchesSynced: { gt: 0 }, status: { in: ["SUCCESS", "PARTIAL"] }, finishedAt: { not: null } }, orderBy: { finishedAt: "desc" } }))),
    prisma.match.count({ where: { status: "LIVE" } }),
  ]);
  return <div className="px-8 py-10"><h1 className="mb-6 text-2xl font-bold text-foreground">Sports</h1><SportTabs/>
    <h2 className="mb-4 text-lg font-semibold">Synchronisation automatique</h2>
    <div className="grid gap-4 md:grid-cols-3">{types.map((type, index) => {
      const log=logs[index], updated=updates[index]?.finishedAt;
      const late=type==="live"&&liveCount>0&&(!updated||Date.now()-updated.getTime()>900000);
      return <section key={type} className="rounded-md border border-border bg-card p-5"><h3 className="font-bold">{labels[type]}</h3>
        <p className="mt-3 text-sm">Dernier passage : {formatRelativeDate(log?.finishedAt??log?.startedAt)}</p>
        <p className="mt-2 text-sm text-muted-foreground">Dernière mise à jour des scores : {formatRelativeDate(updated)}</p>
        <p className="mt-2 text-sm">{log?.status??"Pas encore exécutée"}{log?.finishedAt===null?" · en cours ou interrompue":""} · {log?.matchesSynced??0} match(s)</p>
        {late&&<p role="status" className="mt-3 inline-block rounded-sm bg-red-600 px-2 py-1 text-sm font-bold text-white">Synchronisation en retard</p>}
        {log?.status==="FAILED"&&log.finishedAt&&<p className="mt-2 text-sm text-red-600">Échec : consulter le journal SyncLog.</p>}
      </section>;
    })}</div>
    <Link href="/backoffice/sports/competitions" className="mt-6 inline-block font-semibold text-editorial-link">Gérer les compétitions →</Link>
  </div>;
}
