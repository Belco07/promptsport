import Link from "next/link";

import { isAiConfigured } from "@/lib/ai";
import { cleanupOldNewsAlerts, purgeIgnoredNewsAlerts } from "@/lib/news";
import { prisma } from "@/lib/prisma";

import { ActionButton } from "./ActionButton";
import { translateAlertTitles, triggerManualFetch } from "./actions";
import { AlertList } from "./AlertList";

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
export const maxDuration = 300;

export const metadata = {
  title: "Veille",
};

const PAGE_SIZE = 50;

function readParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readPage(value: string | string[] | undefined): number {
  const page = Number.parseInt(readParam(value) ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function VeillePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = readParam(params.error);
  const info = readParam(params.info);
  const refreshed = readParam(params.refreshed) === "1";
  const aiReady = isAiConfigured();
  await cleanupOldNewsAlerts();
  await purgeIgnoredNewsAlerts();

  // Le comptage précède la lecture pour ramener une page hors limites sur la
  // dernière page existante (les alertes de plus de 48 h sont purgées à chaque
  // chargement, le nombre total peut donc diminuer entre deux visites).
  const total = await prisma.newsAlert.count();
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(readPage(params.page), pageCount);
  const skip = (page - 1) * PAGE_SIZE;

  const [alerts, pending, generated, activeSources, untranslated] =
    await Promise.all([
      prisma.newsAlert.findMany({
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip,
        take: PAGE_SIZE,
        include: { source: { select: { name: true, type: true } } },
      }),
      prisma.newsAlert.count({ where: { status: "PENDING" } }),
      prisma.newsAlert.count({ where: { status: "DRAFT_GENERATED" } }),
      prisma.newsSource.count({ where: { active: true } }),
      prisma.newsAlert.count({ where: { titleFr: null } }),
    ]);

  const pageHref = (target: number) =>
    target > 1 ? `/backoffice/veille?page=${target}` : "/backoffice/veille";

  return (
    <div className="px-8 py-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        News Engine
      </p>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Veille</h1>
        <div className="flex flex-wrap items-center gap-3">
          <form action={triggerManualFetch}>
            <ActionButton label="Actualiser la veille" pendingLabel="Récupération en cours..." title="Récupérer les nouvelles alertes des sources actives" />
          </form>
        <Link
          href="/backoffice/veille/sources"
          className="rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          Gérer les sources ({activeSources})
        </Link>
        </div>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Les sources actives — médias, YouTube et réseaux sociaux — sont interrogées par{" "}
        <code>npm run news:fetch</code>. Chaque alerte peut être transformée en brouillon
        par l&apos;IA : la publication reste une décision humaine, depuis le studio. Les
        alertes de plus de <strong>48 h</strong> sont supprimées automatiquement ; une
        alerte ignorée est supprimée immédiatement et définitivement. Les brouillons
        déjà créés restent dans le studio.
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
          className={refreshed
            ? "fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-status-success-border bg-status-success px-4 py-3 text-sm text-status-success-foreground shadow-lg"
            : "mb-6 rounded-lg border border-status-success-border bg-status-success px-4 py-3 text-sm text-status-success-foreground"}
        >
          {info}
          {refreshed && <Link href="/backoffice/veille" className="ml-3 underline">Fermer</Link>}
        </div>
      ) : null}

      {!aiReady ? (
        <div className="mb-6 rounded-lg border border-status-warning-border bg-status-warning px-4 py-3 text-sm text-status-warning-foreground">
          La clé IA n&apos;est pas configurée. Renseignez <code>DEEPSEEK_API_KEY</code> dans
          <code> .env</code> (et sur Vercel) pour activer la génération. Les alertes
          restent consultables.
        </div>
      ) : null}

      {untranslated > 0 ? (
        <form
          action={translateAlertTitles}
          className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
        >
          <ActionButton
            label={`Traduire les titres (${untranslated})`}
            pendingLabel="Traduction…"
            disabled={!aiReady}
            title={
              aiReady
                ? "Traduire en français les titres encore dans leur langue d'origine"
                : "DEEPSEEK_API_KEY manquante"
            }
          />
          <p className="text-sm text-muted-foreground">
            {untranslated} titre(s) à traduire, par lots de 40. La traduction est faite
            par l&apos;IA et enregistrée pour les prochaines consultations.
          </p>
        </form>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "En attente", value: pending },
          { label: "Brouillons générés", value: generated },
          { label: "Titres à traduire", value: untranslated },
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

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-foreground">Aucune alerte pour le moment.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {activeSources === 0
              ? "Ajoutez une source de veille (NewsSource) puis lancez npm run news:fetch."
              : "Lancez npm run news:fetch pour interroger les sources actives."}
          </p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-foreground">Aucune alerte sur cette page.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link href="/backoffice/veille" className="underline">
              Revenir à la première page
            </Link>
          </p>
        </div>
      ) : (
        <AlertList alerts={alerts.map(alert => ({ ...alert, publishedAt: alert.publishedAt.toISOString() }))} aiReady={aiReady} />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          {total === 0 || alerts.length === 0
            ? `${total} alerte(s) au total.`
            : `${skip + 1} à ${skip + alerts.length} sur ${total} alerte(s).`}
        </p>
        {pageCount > 1 ? (
          <nav aria-label="Pagination de la veille" className="flex flex-wrap items-center gap-4 text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} rel="prev" className="text-editorial-link underline hover:text-editorial-link">
                ← Page précédente
              </Link>
            ) : (
              <span>← Page précédente</span>
            )}
            <span className="text-muted-foreground">
              Page {page} sur {pageCount}
            </span>
            {page < pageCount ? (
              <Link href={pageHref(page + 1)} rel="next" className="text-editorial-link underline hover:text-editorial-link">
                Page suivante →
              </Link>
            ) : (
              <span>Page suivante →</span>
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
