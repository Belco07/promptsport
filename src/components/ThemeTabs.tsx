"use client";

import { useRef, useState } from "react";

import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { themeBadgeStyle, themeIcon } from "@/lib/themes";

/**
 * Onglets thématiques de l'accueil (WP16d).
 *
 * Les articles sont pré-chargés côté serveur (une seule requête, groupée par
 * thème) : ce composant ne fait que basculer l'affichage, sans requête
 * supplémentaire.
 *
 * Accessibilité : structure `tablist` / `tab` / `tabpanel`, onglet actif marqué
 * par `aria-selected`, navigation au clavier par flèches gauche/droite (et
 * Origine/Fin), un seul onglet dans l'ordre de tabulation (`tabIndex`).
 */

export type ThemeTab = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  articles: ArticleCardData[];
};

export function ThemeTabs({ themes }: { themes: ThemeTab[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (themes.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">Aucun thème actif pour le moment.</p>;
  }

  const active = themes[Math.min(activeIndex, themes.length - 1)];

  function selectTab(index: number) {
    setActiveIndex(index);
    tabRefs.current[index]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectTab((index + 1) % themes.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectTab((index - 1 + themes.length) % themes.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectTab(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectTab(themes.length - 1);
    }
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Thèmes éditoriaux"
        className="mb-5 flex flex-nowrap gap-1.5 overflow-x-auto border-b border-border pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {themes.map((theme, index) => {
          const Icon = themeIcon(theme.icon);
          const selected = index === activeIndex;
          return (
            <button
              key={theme.id}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`theme-tab-${theme.slug}`}
              aria-selected={selected}
              aria-controls={`theme-panel-${theme.slug}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveIndex(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap !rounded-full border px-2.5 text-[13px] font-semibold transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 ${selected ? "border-foreground/35" : "border-transparent hover:opacity-80"}`}
              style={selected ? themeBadgeStyle(theme.color) : { ...themeBadgeStyle(theme.color), opacity: 0.55 }}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{theme.name}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`theme-panel-${active.slug}`}
        aria-labelledby={`theme-tab-${active.slug}`}
        tabIndex={0}
      >
        {active.articles.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">Aucun article pour ce thème.</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {active.articles.map((article) => (
              <ArticleCard key={article.slug} article={article} headingLevel={3} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ThemeTabs;
