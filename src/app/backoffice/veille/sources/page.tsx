import Link from "next/link";

import { prisma } from "@/lib/prisma";
import { AUTO_PUBLISH_RELIABILITY } from "@/lib/news-automation";
import {
  facebookPublishingConfigured,
  instagramPublishingConfigured,
} from "@/lib/social-platforms";

import { ActionButton } from "../ActionButton";
import {
  addNewsSource,
  deleteNewsSource,
  updateNewsSourceAutomation,
} from "../actions";

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
  FLASHSCORE: "Flashscore",
  SITEMAP: "Sitemap d'actualités",
  OFFICIAL_SITE: "Site officiel",
  JSON: "API JSON",
  MANUAL: "Site officiel (référence)",
};

const TOKEN_SOURCE_TYPES = new Set(["X", "FACEBOOK", "INSTAGRAM", "YOUTUBE"]);

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
    orderBy: [
      { active: "desc" },
      { isOfficial: "desc" },
      { type: "asc" },
      { name: "asc" },
    ],
    select: {
      id: true,
      name: true,
      type: true,
      url: true,
      active: true,
      isOfficial: true,
      reliability: true,
      autoPublish: true,
      imagePolicy: true,
      _count: { select: { alerts: true } },
    },
  });
  const activeSources = sources.filter((source) => source.active).length;

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
    {
      label: "YouTube",
      ready: Boolean(process.env.YOUTUBE_API_KEY?.trim()),
      missing: "YOUTUBE_API_KEY",
    },
  ];

  const publishingAccess = [
    {
      label: "Facebook",
      ready: facebookPublishingConfigured(),
      missing: "META_FACEBOOK_TOKEN + META_FACEBOOK_PAGE_ID",
    },
    {
      label: "Instagram",
      ready: instagramPublishingConfigured(),
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
        médias passent par un flux RSS, une chaîne YouTube ou un connecteur dédié.
        Les <strong>sources officielles</strong> — clubs, fédérations, confédérations,
        ligues, joueurs et personnalités — sont marquées « Officiel » et restent la
        référence de première main. X, Facebook, Instagram et YouTube utilisent
        leurs API officielles, avec des tokens ou une clé d&apos;accès. Pour TikTok
        ou une plateforme sans API accessible, utilisez un flux RSS de passerelle
        (RSSHub, Nitter…) et choisissez « Réseau social (RSS) ».
      </p>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        La <strong>fiabilité</strong> (0 à 100) sert au calcul de viralité et à la
        publication automatique. Celle-ci n&apos;est possible que si la source est
        explicitement marquée « publication automatique », atteint{" "}
        <strong>{AUTO_PUBLISH_RELIABILITY}/100</strong> et autorise la reprise de
        ses photos. Sinon, les articles générés restent des brouillons à relire
        dans le studio.
      </p>
      <p className="mb-6 max-w-3xl text-sm text-muted-foreground">
        <strong>Photo source</strong> : par défaut, les images ne sont pas
        reprises et les articles restent sans couverture. Une source marquée
        « autorisée » doit disposer d&apos;une licence ou d&apos;une autorisation
        explicite ; la photo est alors réhébergée et publiée avec le crédit de la
        source. Une photo est obligatoire pour publier un article.
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
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="mt-3 border-t border-border pt-3">
          <h3 className="text-xs font-semibold text-foreground">Publication Meta</h3>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            {publishingAccess.map((access) => (
              <p key={access.label} className="text-muted-foreground">
                <span className="font-medium text-foreground">{access.label}</span> :{" "}
                <span
                  className={
                    access.ready
                      ? "font-medium text-status-success-foreground"
                      : "font-medium text-status-error-foreground"
                  }
                >
                  {access.ready ? "configuré" : "non configuré"}
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
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Les sources X, Facebook, Instagram et YouTube sans identifiant sont
          conservées dans la liste mais restent inactives : elles ne provoquent
          pas d&apos;échec de collecte. Après configuration des variables,
          redéployez puis activez uniquement les sources concernées. Les tokens ne
          sont jamais affichés dans le backoffice.
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
        <form action={addNewsSource} className="p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_190px_minmax(0,1.4fr)_auto] md:items-end">
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
                <option value="FLASHSCORE">Flashscore Actualités</option>
                <option value="SITEMAP">Sitemap d&apos;actualités</option>
                <option value="OFFICIAL_SITE">Site officiel</option>
                <option value="JSON">API JSON</option>
                <option value="MANUAL">Site officiel (référence)</option>
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
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <label className="block w-40">
              <span className={labelClass}>Fiabilité (0-100)</span>
              <input
                type="number"
                name="reliability"
                min={0}
                max={100}
                step={1}
                defaultValue={50}
                className={inputClass}
              />
            </label>
            <label className="block w-56">
              <span className={labelClass}>Photo source</span>
              <select name="imagePolicy" defaultValue="REFERENCE_ONLY" className={inputClass}>
                <option value="REFERENCE_ONLY">Non autorisée</option>
                <option value="LICENSED">Autorisée (licence + crédit)</option>
              </select>
            </label>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input type="checkbox" name="isOfficial" className="mt-0.5" />
              <span>
                Source officielle (club, fédération, confédération, ligue, joueur
                ou personnalité). Elle sera signalée par un badge « Officiel »
                dans la veille.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input type="checkbox" name="autoPublish" className="mt-0.5" />
              <span>
                Publication automatique des articles générés (effective seulement
                à partir de {AUTO_PUBLISH_RELIABILITY}/100 de fiabilité).
              </span>
            </label>
          </div>
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
          <p>
            Flashscore : URL de la page <code>/actualites/</code>. Sitemap :
            URL XML d&apos;actualités. Site officiel : page de listing des
            actualités (le domaine doit avoir un connecteur). API JSON : endpoint
            public. Site officiel (référence) : site conservé dans la liste sans
            collecte automatique.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            Sources configurées ({sources.length})
            <span className="ml-2 font-normal text-muted-foreground">
              · {activeSources} actives
            </span>
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
            Aucune source configurée. Ajoutez-en une ci-dessus.
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <caption className="sr-only">Sources de veille configurées</caption>
              <thead className="sticky top-0 border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Nom
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Statut
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    URL
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Alertes
                  </th>
                  <th scope="col" className="px-4 py-3 font-semibold">
                    Automatisation
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
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{source.name}</span>
                        {source.isOfficial ? (
                          <span className="inline-flex rounded bg-status-success px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-status-success-foreground">
                            Officiel
                          </span>
                        ) : null}
                        <span
                          className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${
                            source.autoPublish && source.reliability >= AUTO_PUBLISH_RELIABILITY
                              ? "bg-status-success text-status-success-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                          title={
                            source.autoPublish && source.reliability < AUTO_PUBLISH_RELIABILITY
                              ? `Publication automatique inactive : fiabilité ${source.reliability}/100, seuil ${AUTO_PUBLISH_RELIABILITY}`
                              : undefined
                          }
                        >
                          {source.autoPublish
                            ? source.reliability >= AUTO_PUBLISH_RELIABILITY
                              ? "Auto"
                              : "Auto (seuil non atteint)"
                            : "Manuel"}
                        </span>
                        <span
                          className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${
                            source.imagePolicy === "LICENSED"
                              ? "bg-status-success text-status-success-foreground"
                              : "bg-status-warning text-status-warning-foreground"
                          }`}
                          title={
                            source.imagePolicy === "LICENSED"
                              ? "Photo source autorisée : reprise avec crédit"
                              : "Photo source non autorisée : articles sans couverture"
                          }
                        >
                          {source.imagePolicy === "LICENSED" ? "Photo licence" : "Photo non autorisée"}
                        </span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Fiabilité {source.reliability}/100
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {SOURCE_TYPE_LABELS[source.type] ?? source.type}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {source.active ? (
                        <span className="font-medium text-status-success-foreground">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex rounded bg-muted px-2 py-0.5 font-medium text-muted-foreground">
                          {TOKEN_SOURCE_TYPES.has(source.type)
                            ? source.type === "YOUTUBE"
                              ? "En attente de clé"
                              : "En attente de token"
                            : "Inactive"}
                        </span>
                      )}
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
                      <form
                        action={updateNewsSourceAutomation.bind(null, source.id)}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Fiabilité
                          </span>
                          <input
                            type="number"
                            name="reliability"
                            min={0}
                            max={100}
                            step={1}
                            defaultValue={source.reliability}
                            aria-label={`Fiabilité de ${source.name}`}
                            className="w-20 rounded-md border border-border px-2 py-1.5 text-xs text-foreground outline-none focus:border-editorial-link"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                            Photo
                          </span>
                          <select
                            name="imagePolicy"
                            defaultValue={source.imagePolicy}
                            aria-label={`Droit photo de ${source.name}`}
                            className="rounded-md border border-border px-2 py-1.5 text-xs text-foreground outline-none focus:border-editorial-link"
                          >
                            <option value="REFERENCE_ONLY">Non autorisée</option>
                            <option value="LICENSED">Autorisée</option>
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-foreground">
                          <input
                            type="checkbox"
                            name="autoPublish"
                            defaultChecked={source.autoPublish}
                            aria-label={`Publication automatique de ${source.name}`}
                          />
                          Auto
                        </label>
                        <ActionButton
                          label="Enregistrer"
                          pendingLabel="…"
                          variant="secondary"
                          title={`Enregistrer l'automatisation de ${source.name}`}
                        />
                      </form>
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
        Les sources inactives sont conservées pour être activées après
        configuration de leur accès. La suppression d&apos;une source est définitive :
        ses alertes de veille sont supprimées immédiatement ; les brouillons créés
        dans le studio restent intacts.
      </p>
    </div>
  );
}
