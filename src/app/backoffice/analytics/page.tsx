import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AnalyticsChart } from "@/components/AnalyticsChart";
import { auth } from "@/lib/auth";
import {
  addUtcDays,
  getAnalyticsKpis,
  getTopArticles,
  getTopPages,
  getTopSources,
  getTrafficSeries,
  startOfUtcDay,
} from "@/lib/analytics";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";

/**
 * Tableau de bord analytics (WP8d) : audience first-party, sans dépendance
 * externe. Accès réservé aux ADMIN (middleware /backoffice/*, doublé ici).
 */

export const metadata: Metadata = {
  title: "Analytics",
};

export const dynamic = "force-dynamic";

const cardClass = "rounded-lg border border-gray-200 bg-white p-4";
const thClass = "px-4 py-3 font-semibold";
const tdClass = "px-4 py-3";

/** Libellé court d'un jour (« 12/09 »). */
function shortDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className={cardClass}>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
    </div>
  );
}

function TopList({
  title,
  description,
  entries,
  emptyLabel,
}: {
  title: string;
  description: string;
  entries: Array<{ label: string; count: number; href?: string | null }>;
  emptyLabel: string;
}) {
  return (
    <section className={cardClass}>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-xs text-gray-500">{description}</p>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">{emptyLabel}</p>
      ) : (
        <ol className="mt-4 space-y-2">
          {entries.map((entry, index) => (
            <li key={`${entry.label}-${index}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-xs text-gray-400">{index + 1}.</span>
                {entry.href ? (
                  <Link href={entry.href} className="text-blue-700 underline transition-colors hover:text-blue-900">
                    {entry.label}
                  </Link>
                ) : (
                  <span className="text-gray-800">{entry.label}</span>
                )}
              </span>
              <span className="shrink-0 font-medium text-gray-900">{entry.count}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function AnalyticsDashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/studio");
  }

  const now = new Date();
  const startOfToday = startOfUtcDay(now);
  const since7 = addUtcDays(startOfToday, -6);
  const since30 = addUtcDays(startOfToday, -29);

  const [kpis, series, topPages, topSources, topArticles, dailyRows] = await Promise.all([
    getAnalyticsKpis(now),
    getTrafficSeries(30, now),
    getTopPages(since7, 10),
    getTopSources(since7, 5),
    getTopArticles(since7, 10),
    prisma.analyticsDaily.findMany({
      where: { date: { gte: since30 } },
      orderBy: { date: "desc" },
      take: 30,
      select: {
        id: true,
        date: true,
        visitors: true,
        newVisitors: true,
        returningVisitors: true,
        pageViews: true,
      },
    }),
  ]);

  const hasData = kpis.mau > 0 || dailyRows.length > 0;

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">Analytics</h1>
      <p className="mb-6 text-sm text-gray-600">
        Audience mesurée en first-party, sans cookie tiers ni donnée personnelle.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="DAU (aujourd'hui)" value={kpis.dau} hint="visiteurs uniques depuis minuit UTC" />
        <KpiCard label="WAU (7 jours)" value={kpis.wau} hint="visiteurs uniques" />
        <KpiCard label="MAU (30 jours)" value={kpis.mau} hint="visiteurs uniques" />
        <KpiCard
          label="Taux de retour (30 j)"
          value={`${kpis.returningRate.toLocaleString("fr-FR")} %`}
          hint={`${kpis.returningVisitors} récurrents / ${kpis.mau} visiteurs`}
        />
        <KpiCard label="Pages vues (30 j)" value={kpis.pageViews} />
      </div>

      {!hasData ? (
        <p className="mt-8 rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Aucune donnée d&apos;audience pour le moment : les visites des pages publiques
          apparaîtront ici, et les agrégats journaliers après exécution de{" "}
          <code className="font-mono">npm run analytics:aggregate</code>.
        </p>
      ) : null}

      <section className={`${cardClass} mt-6`}>
        <h2 className="text-base font-semibold text-gray-900">
          Visiteurs uniques par jour (30 derniers jours)
        </h2>
        <p className="mb-4 mt-1 text-xs text-gray-500">
          Jours agrégés + aujourd&apos;hui compté en direct.
        </p>
        <AnalyticsChart
          points={series.map((point) => ({
            label: shortDate(point.date),
            visitors: point.visitors,
          }))}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopList
          title="Top 10 pages"
          description="7 derniers jours"
          entries={topPages}
          emptyLabel="Aucune page vue sur la période."
        />
        <TopList
          title="Top 5 sources"
          description="7 derniers jours"
          entries={topSources}
          emptyLabel="Aucune source sur la période."
        />
        <TopList
          title="Top 10 articles"
          description="7 derniers jours"
          entries={topArticles}
          emptyLabel="Aucun article lu sur la période."
        />
      </div>

      <section className={`${cardClass} mt-6`}>
        <h2 className="text-base font-semibold text-gray-900">Détail par jour</h2>
        <p className="mt-1 text-xs text-gray-500">
          Agrégats journaliers (calculés par <code className="font-mono">npm run analytics:aggregate</code>).
        </p>

        {dailyRows.length === 0 ? (
          <p className="mt-4 text-sm text-gray-500">Aucun agrégat journalier disponible.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className={thClass}>Jour</th>
                  <th className={thClass}>Visiteurs</th>
                  <th className={thClass}>Nouveaux</th>
                  <th className={thClass}>Récurrents</th>
                  <th className={thClass}>Pages vues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dailyRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className={`${tdClass} text-gray-900`}>{formatDate(row.date)}</td>
                    <td className={`${tdClass} font-medium text-gray-900`}>{row.visitors}</td>
                    <td className={`${tdClass} text-gray-700`}>{row.newVisitors}</td>
                    <td className={`${tdClass} text-gray-700`}>{row.returningVisitors}</td>
                    <td className={`${tdClass} text-gray-700`}>{row.pageViews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs text-gray-500">
        Rétention : les événements bruts (pages vues) sont purgés au-delà de 90 jours par
        le script d&apos;agrégation ; les agrégats journaliers sont conservés sans limite.
        Aucune adresse IP n&apos;est stockée.
      </p>
    </div>
  );
}
