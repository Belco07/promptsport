import Link from "next/link";

import { isAiConfigured } from "@/lib/ai";
import { prisma } from "@/lib/prisma";

import { ActionButton } from "./ActionButton";
import { generateArticle, ignoreAlert } from "./actions";

/**
 * Backoffice — veille éditoriale (WP41).
 *
 * Liste les alertes collectées par `scripts/fetch-news.ts`, triées de la plus
 * récente à la plus ancienne. Le bouton « Générer avec l'IA » crée toujours un
 * brouillon : aucune publication automatique.
 *
 * L'accès ADMIN est garanti par le layout /backoffice ; les Server Actions
 * revérifient le rôle de leur côté.
 */

export const dynamic = "force-dynamic";
// L'appel au fournisseur IA peut dépasser la limite par défaut d'une fonction.
export const maxDuration = 60;

export const metadata = {
  title: "Veille",
};

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

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function readParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VeillePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = readParam(params.error);
  const info = readParam(params.info);
  const aiReady = isAiConfigured();

  const [alerts, pending, generated, ignored, activeSources] = await Promise.all([
    prisma.newsAlert.findMany({
      orderBy: { publishedAt: "desc" },
      take: 100,
      include: { source: { select: { name: true, type: true } } },
    }),
    prisma.newsAlert.count({ where: { status: "PENDING" } }),
    prisma.newsAlert.count({ where: { status: "DRAFT_GENERATED" } }),
    prisma.newsAlert.count({ where: { status: "IGNORED" } }),
    prisma.newsSource.count({ where: { active: true } }),
  ]);

  return (
    <div className="px-8 py-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        News Engine
      </p>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Veille</h1>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Les sources actives sont interrogées par <code>npm run news:fetch</code>. Chaque
        alerte peut être transformée en brouillon par l&apos;IA : la publication reste une
        décision humaine, depuis le studio.
      </p>

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-status-error-border bg-status-error px-4 py-3 text-sm text-status-error-foreground"
        >
          {error}
        </div>
      ) : null}

      {info ? (
        <div
          role="status"
          className="mb-6 rounded-lg border border-status-success-border bg-status-success px-4 py-3 text-sm text-status-success-foreground"
        >
          {info}
        </div>
      ) : null}

      {!aiReady ? (
        <div className="mb-6 rounded-lg border border-status-warning-border bg-status-warning px-4 py-3 text-sm text-status-warning-foreground">
          La clé IA n&apos;est pas configurée. Renseignez <code>DEEPSEEK_API_KEY</code> dans
          <code> .env</code> (et sur Vercel) pour activer la génération. Les alertes
          restent consultables.
        </div>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "En attente", value: pending },
          { label: "Brouillons générés", value: generated },
          { label: "Ignorées", value: ignored },
          { label: "Sources actives", value: activeSources },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-foreground">Aucune alerte pour le moment.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {activeSources === 0
              ? "Ajoutez une source de veille (NewsSource) puis lancez npm run news:fetch."
              : "Lancez npm run news:fetch pour interroger les sources actives."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">Alertes de veille éditoriale</caption>
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
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
                return (
                  <tr key={alert.id} className="align-top hover:bg-muted">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      <time dateTime={alert.publishedAt.toISOString()}>
                        {dateFormatter.format(alert.publishedAt)}
                      </time>
                    </td>
                    <td className="max-w-xl px-4 py-3">
                      <a
                        href={alert.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-editorial-link"
                      >
                        {alert.title}
                      </a>
                      {alert.content ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {alert.content}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="font-medium text-foreground">{alert.source.name}</span>
                      <span className="mt-1 block text-muted-foreground">
                        {alert.source.type === "RSS" ? "Flux RSS" : "YouTube"}
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
                          <form action={generateArticle.bind(null, alert.id)}>
                            <ActionButton
                              label="Générer avec l'IA"
                              pendingLabel="Génération…"
                              disabled={!aiReady}
                              title={
                                aiReady
                                  ? "Créer un brouillon relu par un humain avant publication"
                                  : "DEEPSEEK_API_KEY manquante"
                              }
                            />
                          </form>
                          <form action={ignoreAlert.bind(null, alert.id)}>
                            <ActionButton
                              label="Ignorer"
                              pendingLabel="…"
                              variant="secondary"
                            />
                          </form>
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
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        {alerts.length === 100
          ? "Les 100 alertes les plus récentes sont affichées."
          : `${alerts.length} alerte(s) affichée(s).`}
      </p>
    </div>
  );
}
