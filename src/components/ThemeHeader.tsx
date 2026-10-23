import { Breadcrumbs } from "@/components/Breadcrumbs";

import { themeBadgeStyle, themeIcon } from "@/lib/themes";

/**
 * En-tête d'une page de thème (WP16c).
 *
 * Composant serveur, sans état : badge coloré (couleur et icône du thème),
 * nom, description et nombre d'articles publiés. Les couleurs viennent du
 * thème (`themeBadgeStyle`) et le reste des jetons sémantiques (WP13), donc
 * lisible en clair comme en sombre.
 */
export function ThemeHeader({
  theme,
  articleCount,
  filteredCount,
}: {
  theme: { name: string; slug: string; description: string | null; color: string | null; icon: string | null };
  /** Nombre total d'articles publiés pour ce thème. */
  articleCount: number;
  /** Nombre d'articles après application du filtre de format. */
  filteredCount?: number;
}) {
  const Icon = themeIcon(theme.icon);
  const label = `${articleCount} article${articleCount > 1 ? "s" : ""}`;

  return (
    <header className="page-band">
      <Breadcrumbs items={[{ label: "Thèmes", href: "/themes" }, { label: theme.name, href: `/theme/${theme.slug}` }]} className="mb-2" />

      <div className="flex flex-wrap items-center gap-4">
        <span
          className="theme-badge"
          style={{ ...themeBadgeStyle(theme.color), fontSize: "0.8rem", padding: "6px 12px" }}
        >
          <Icon size={16} aria-hidden="true" />
          {theme.name}
        </span>
        <h1 className="text-3xl font-black tracking-tight text-foreground sm:text-4xl">
          {theme.name}
        </h1>
      </div>

      <p className="mt-4 max-w-prose text-base leading-7 text-muted-foreground">
        {theme.description?.trim() ||
          `Tous les articles publiés sur le thème ${theme.name} sur PromptSport.`}
      </p>

      <p className="mt-3 text-sm font-semibold text-muted-foreground">
        {label}
        {typeof filteredCount === "number" && filteredCount !== articleCount
          ? ` · ${filteredCount} avec le filtre en cours`
          : ""}
      </p>
    </header>
  );
}

export default ThemeHeader;
