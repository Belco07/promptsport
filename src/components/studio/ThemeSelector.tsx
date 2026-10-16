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

/**
 * Texte lisible sur une couleur : noir ou blanc, selon le meilleur contraste.
 *
 * `themeTextColor` (lib/themes) tranche par seuil de luminance ; au voisinage
 * du seuil, ce choix peut rester sous le rapport 4.5:1 exigé par axe. Comparer
 * les deux ratios garantit au moins 4.58:1 quelle que soit la couleur.
 */
function readableTextColor(background: string): "#000000" | "#ffffff" {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const ratio = (first: number, second: number) =>
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  const backgroundLuminance = luminance(background);
  return ratio(backgroundLuminance, luminance("#000000")) >=
    ratio(backgroundLuminance, luminance("#ffffff"))
    ? "#000000"
    : "#ffffff";
}

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
        // Thème retenu : fond plein, texte noir ou blanc selon le contraste.
        // Thème non retenu : plus d'aplat à 50 % d'opacité (il écrasait le
        // contraste) — l'icône colorée porte l'identité, le texte reste lisible.
        const chipStyle = selected
          ? {
              backgroundColor: badge.backgroundColor,
              color: readableTextColor(badge.backgroundColor),
            }
          : undefined;
        return (
          <button
            key={theme.id}
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Thème ${theme.name}`}
            onClick={() => toggle(theme.id)}
            className={`theme-badge text-foreground${selected ? " theme-badge--on" : " theme-badge--off"}`}
            style={chipStyle}
          >
            <Icon
              size={14}
              aria-hidden="true"
              style={selected ? undefined : { color: badge.backgroundColor }}
            />
            <span>{theme.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ThemeSelector;
