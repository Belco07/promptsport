import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";

import { themeBadgeStyle, themeIcon } from "@/lib/themes";

/**
 * Carte d'un thème éditorial (WP16d) — page /themes.
 *
 * Badge coloré avec l'icône du thème, nom, description et nombre d'articles
 * publiés ; toute la carte mène à la page du thème.
 */
export function ThemeCard({
  theme,
}: {
  theme: {
    name: string;
    slug: string;
    description: string | null;
    color: string | null;
    icon: string | null;
    articleCount: number;
  };
}) {
  const Icon = themeIcon(theme.icon);

  return (
    <Link
      href={`/theme/${theme.slug}`}
      className="group flex min-w-0 flex-col gap-3 rounded-[13px] border border-border bg-card p-5 shadow-[0_4px_20px_rgb(0_0_0/7%)] transition-shadow hover:shadow-[0_6px_28px_rgb(0_0_0/12%)]"
    >
      <span className="theme-badge w-fit" style={themeBadgeStyle(theme.color)}>
        <Icon size={14} aria-hidden="true" />
        {theme.name}
      </span>

      <span className="text-lg font-black tracking-tight text-foreground group-hover:underline">
        {theme.name}
      </span>

      <span className="text-sm leading-6 text-muted-foreground">
        {theme.description?.trim() || `Tous les articles publiés sur le thème ${theme.name}.`}
      </span>

      <span className="mt-auto inline-flex items-center gap-1 text-xs font-bold text-foreground">
        {theme.articleCount} article{theme.articleCount > 1 ? "s" : ""}
        <ArrowUpRight size={14} aria-hidden="true" />
      </span>
    </Link>
  );
}

export default ThemeCard;
