import Link from "next/link";

import { prisma } from "@/lib/prisma";

import { ActionButton } from "../ActionButton";
import { addNewsSource, deleteNewsSource } from "../actions";

/**
 * Backoffice — gestion des sources de veille (WP41).
 *
 * Cette page liste toutes les sources actives et permet d'en ajouter une
 * manuellement ou de la supprimer définitivement. La suppression d'une source
 * entraîne celle de ses alertes (cascade), mais jamais celle des brouillons
 * éventuellement générés.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sources de veille",
};

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
};

const inputClass =
  "w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-editorial-link focus:ring-1 focus:ring-blue-600";
const labelClass = "mb-1 block text-xs font-medium text-foreground";

function readParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VeilleSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = readParam(params.error);
  const info = readParam(params.info);

  const sources = await prisma.newsSource.findMany({
    where: { active: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      type: true,
      url: true,
      _count: { select: { alerts: true } },
    },
  });

  const apiAccess = [
    {
      label: "X",
      ready: Boolean(process.env.X_BEARER_TOKEN?.trim()),
      missing: "X_BEARER_TOKEN",
    },
    {
      label: "Facebook",
      ready: Boolean(process.env.META_ACCESS_TOKEN?.trim()),
      missing: "META_ACCESS_TOKEN",
    },
    {
      label: "Instagram",
      ready: Boolean(
        process.env.META_ACCESS_TOKEN?.trim() &&
          process.env.META_IG_USER_ID?.trim(),
      ),
      missing: "META_ACCESS_TOKEN + META_IG_USER_ID",
    },
  ];

  return (
    <div className="px-8 py-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        News Engine
      </p>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        Sources de veille
      </h1>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        Les sources actives sont interrogées par <code>npm run news:fetch</code>. Les
        médias passent par un flux RSS ou une chaîne YouTube. Bluesky, Mastodon et
        Reddit sont lus via leur API publique. X, Facebook et Instagram utilisent
        leurs API officielles, avec des tokens d&apos;accès. Pour TikTok ou une
        plateforme sans API accessible, utilisez un flux RSS de passerelle (RSSHub,
        Nitter…) et choisissez « Réseau social (RSS) ».
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

      <section className="mb-6 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Accès API</h2>
          <p className="text-xs text-muted-foreground">
            Variables d&apos;environnement, puis redéploiement.
          </p>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          {apiAccess.map((access) => (
            <p key={access.label} className="text-muted-foreground">
              <span className="font-medium text-foreground">{access.label}</span> :{" "}
              <span
                className={
                  access.ready
                    ? "font-medium text-status-success-foreground"
                    : "font-medium text-status-error-foreground"
                }
              >
                {access.ready ? "configuré" : "token manquant"}
              </span>
              {access.ready ? null : (
                <>
                  {" "}
                  (<code>{access.missing}</code>)
                </>
              )}
            </p>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Une source peut être ajoutée même sans token, mais sa collecte échouera
          jusqu&apos;à la configuration. Les tokens ne sont jamais affichés dans le
          backoffice.
        </p>
      </section>

      <section className="mb-8 rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Ajouter une source</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            L&apos;ajout est immédiat et la source sera prise en compte à la prochaine
            collecte.
          </p>
        </div>
        <form
          action={addNewsSource}
          className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_190px_minmax(0,1.4fr)_auto] md:items-end"
        >
          <label className="block">
            <span className={labelClass}>Nom</span>
            <input
              type="text"
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="Ex. L'Équipe"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Type</span>
            <select name="type" defaultValue="RSS" className={inputClass}>
              <option value="RSS">Flux RSS / Atom</option>
              <option value="YOUTUBE">YouTube</option>
              <option value="BLUESKY">Bluesky</option>
              <option value="MASTODON">Mastodon</option>
              <option value="REDDIT">Reddit</option>
              <option value="X">X (Twitter)</option>
              <option value="FACEBOOK">Facebook</option>
              <option value="INSTAGRAM">Instagram</option>
              <option value="SOCIAL">Réseau social (RSS)</option>
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>URL</span>
            <input
              type="url"
              name="url"
              required
              placeholder="https://…"
              className={inputClass}
            />
          </label>
          <ActionButton label="Ajouter la source" pendingLabel="Ajout…" />
        </form>
        <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <p>
            YouTube : URL de la chaîne (<code>/@handle</code> ou{" "}
            <code>/channel/…</code>). Bluesky :{" "}
            <code>https://bsky.app/profile/…</code>. Mastodon :{" "}
            <code>https://instance.social/@compte</code>. Reddit : URL du
            subreddit ou du profil.
          </p>
          <p>
            X : URL du profil (<code>https://x.com/…</code>). Facebook : URL de
            la page. Instagram : URL du profil Business/Creator. Réseau social
            (RSS) : URL du flux fourni par la passerelle.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Sources actives ({sources.length})
          </h2>
          <Link
            href="/backoffice/veille"
            className="text-xs font-medium text-editorial-link underline hover:text-editorial-link"
          >
            Retour à la veille
          </Link>
        </div>

        {sources.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Aucune source active. Ajoutez-en une ci-dessus.
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">Sources de veille actives</caption>
              <thead className="sticky top-0 border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Nom
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    URL
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Alertes
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sources.map((source) => (
                  <tr key={source.id} className="align-top hover:bg-muted">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {source.name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {SOURCE_TYPE_LABELS[source.type] ?? source.type}
                    </td>
                    <td className="max-w-md px-4 py-3 text-xs">
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={source.url}
                        className="block truncate text-editorial-link underline"
                      >
                        {source.url}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {source._count.alerts}
                    </td>
                    <td className="px-4 py-3">
                      <form action={deleteNewsSource.bind(null, source.id)}>
                        <ActionButton
                          label="Supprimer"
                          pendingLabel="Suppression…"
                          variant="danger"
                          title="Supprimer la source et toutes ses alertes"
                          confirmMessage={`Supprimer définitivement « ${source.name} » ? Ses ${source._count.alerts} alerte(s) seront aussi supprimées. Les brouillons déjà créés sont conservés.`}
                        />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        La suppression d&apos;une source est définitive. Ses alertes de veille sont
        supprimées immédiatement ; les brouillons créés dans le studio restent intacts.
      </p>
    </div>
  );
}
