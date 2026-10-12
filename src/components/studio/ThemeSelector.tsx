"use client";

import { themeBadgeStyle, themeIcon } from "@/lib/themes";

/**
 * Sélecteur multi-thèmes du studio (WP16b).
 *
 * Les thèmes arrivent de la page (seuls les thèmes actifs, plus ceux déjà
 * associés à l'article en édition). Chaque thème est un badge cliquable :
 * couleur et icône viennent de la base, l'état inactif est rendu par une
 * opacité réduite, et le rôle `checkbox` / `aria-checked` rend le contrôle
 * utilisable au clavier comme au lecteur d'écran.
 *
 * Le registre d'icônes vit dans `src/lib/themes.ts` (partagé avec l'en-tête
 * public des pages de thème, WP16c).
 */

export type ThemeOption = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
};

export function ThemeSelector({
  themes,
  value,
  onChange,
}: {
  /** Thèmes proposés (actifs, plus ceux déjà associés). */
  themes: ThemeOption[];
  /** Identifiants des thèmes sélectionnés. */
  value: string[];
  /** Appelé avec la nouvelle sélection. */
  onChange: (themeIds: string[]) => void;
}) {
  function toggle(themeId: string) {
    onChange(
      value.includes(themeId) ? value.filter((id) => id !== themeId) : [...value, themeId],
    );
  }

  if (themes.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Aucun thème disponible. Créez-les avec <code>npm run db:seed</code>.
      </p>
    );
  }

  return (
    <div role="group" aria-label="Thèmes éditoriaux" className="flex flex-wrap gap-2">
      {themes.map((theme) => {
        const selected = value.includes(theme.id);
        const Icon = themeIcon(theme.icon);
        const badge = themeBadgeStyle(theme.color);
        return (
          <button
            key={theme.id}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Thème ${theme.name}`}
            onClick={() => toggle(theme.id)}
            className={`theme-badge${selected ? " theme-badge--on" : " theme-badge--off"}`}
            style={
              selected
                ? badge
                : // Thème non retenu : la couleur reste lisible, l'opacité marque l'état.
                  { ...badge, opacity: 0.5 }
            }
          >
            <Icon size={14} aria-hidden="true" />
            <span>{theme.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ThemeSelector;
