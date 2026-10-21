import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getSiteConfig } from "@/lib/site-config";

import { updateSiteConfig } from "./actions";

/**
 * Paramètres globaux du site (WP43).
 *
 * Le formulaire écrit une ligne unique (`SiteConfig.id = "default"`) et
 * invalide le cache des métadonnées publiques. Aucune page publique n'est
 * modifiée ici : le layout racine lit simplement le nom et la description.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Paramètres",
};

const inputClass =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-editorial-link focus:ring-1 focus:ring-editorial-link";
const labelClass = "mb-1 block text-sm font-medium text-foreground";
const hintClass = "mt-1 text-xs text-muted-foreground";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/studio");

  const [config, params] = await Promise.all([getSiteConfig(), searchParams]);
  const updatedAtDate = config.updatedAt ? new Date(config.updatedAt) : null;
  const updatedAt =
    updatedAtDate && !Number.isNaN(updatedAtDate.getTime())
      ? new Intl.DateTimeFormat("fr-FR", {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Africa/Lagos",
        }).format(updatedAtDate)
      : null;

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Administration
      </p>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Paramètres</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Configurez l&apos;identité du site. Le nom et la description sont utilisés dans les
        métadonnées publiques ; le mode maintenance est un réglage global.
      </p>

      {params.saved ? (
        <p
          role="status"
          className="mt-6 max-w-2xl rounded-md border border-status-success-border bg-status-success px-3 py-2 text-sm text-status-success-foreground"
        >
          Paramètres enregistrés.
        </p>
      ) : null}

      {params.error ? (
        <p
          role="alert"
          className="mt-6 max-w-2xl rounded-md border border-status-error-border bg-status-error px-3 py-2 text-sm text-status-error-foreground"
        >
          {params.error}
        </p>
      ) : null}

      <form action={updateSiteConfig} className="mt-6 max-w-2xl space-y-5">
        <div>
          <label htmlFor="siteName" className={labelClass}>
            Nom du site
          </label>
          <input
            id="siteName"
            name="siteName"
            type="text"
            required
            minLength={2}
            maxLength={80}
            defaultValue={config.siteName}
            className={inputClass}
            aria-describedby="siteName-hint"
          />
          <p id="siteName-hint" className={hintClass}>
            Affiché dans le titre des pages et les métadonnées Open Graph.
          </p>
        </div>

        <div>
          <label htmlFor="siteDescription" className={labelClass}>
            Description SEO
          </label>
          <textarea
            id="siteDescription"
            name="siteDescription"
            rows={4}
            required
            minLength={10}
            maxLength={300}
            defaultValue={config.siteDescription}
            className={`${inputClass} resize-y`}
            aria-describedby="siteDescription-hint"
          />
          <p id="siteDescription-hint" className={hintClass}>
            300 caractères maximum. Utilisée comme description par défaut du site.
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/40 p-4">
          <label htmlFor="maintenanceMode" className="flex items-center gap-2.5 text-sm font-medium text-foreground">
            <input
              id="maintenanceMode"
              name="maintenanceMode"
              type="checkbox"
              defaultChecked={config.maintenanceMode}
              className="h-4 w-4 rounded border-border accent-primary"
              aria-describedby="maintenanceMode-hint"
            />
            Mode maintenance
          </label>
          <p id="maintenanceMode-hint" className="mt-2 pl-6 text-xs text-muted-foreground">
            Enregistre le site comme étant en maintenance. Ce réglage n&apos;interrompt pas encore
            les pages publiques.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-link"
          >
            Enregistrer
          </button>
          {updatedAt ? (
            <p className="text-xs text-muted-foreground">Dernière mise à jour : {updatedAt}</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
