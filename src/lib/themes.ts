/**
 * Thèmes éditoriaux (WP16a) — constantes et helpers d'affichage.
 *
 * Les thèmes eux-mêmes vivent en base (`Theme`) et sont créés par
 * `prisma/seed.cjs`. Ce fichier ne porte que ce qui sert au rendu : couleur de
 * repli, calcul d'un texte lisible sur la couleur du thème, normalisation du
 * code hexadécimal et registre d'icônes.
 */

import {
  ArrowLeftRight,
  ClipboardList,
  Flame,
  HeartPulse,
  MessageSquareQuote,
  Mic,
  Repeat,
  Tag,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";

/** Couleur de repli : le vert-lime de la charte éditoriale. */
export const THEME_FALLBACK_COLOR = "#d7ff00";

/**
 * Icônes disponibles pour les thèmes (WP16c, complété au WP20).
 *
 * `lucide-react` n'expose pas d'import dynamique par nom : on référence donc
 * explicitement les icônes des thèmes du seed et l'on retombe sur `Tag` pour
 * tout autre nom — le bundle ne contient que ces quelques icônes. Ajouter un
 * thème avec une nouvelle icône demande de l'ajouter ici.
 */
export const THEME_ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight,
  ClipboardList,
  Flame,
  HeartPulse,
  MessageSquareQuote,
  Mic,
  Repeat,
  TrendingUp,
  Trophy,
};

/** Icône d'un thème, avec repli sur `Tag`. */
export function themeIcon(icon?: string | null): LucideIcon {
  return THEME_ICONS[icon ?? ""] ?? Tag;
}

/** Forme minimale attendue d'un thème pour les helpers (aucune dépendance au client Prisma). */
export type ThemeLike = {
  color?: string | null;
  active?: boolean | null;
};

/** Un thème est visible s'il est explicitement inactif ? Non : `active` par défaut. */
export function isThemeActive(theme: ThemeLike): boolean {
  return theme.active !== false;
}

/** Normalise un code couleur hexadécimal (`#rgb` ou `#rrggbb`), sinon `null`. */
export function normaliseThemeColor(color?: string | null): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Luminance relative (WCAG) d'une couleur hexadécimale normalisée. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Texte lisible sur une couleur de thème : noir sur fond clair, blanc sur fond sombre. */
export function themeTextColor(color?: string | null): string {
  const normalised = normaliseThemeColor(color) ?? THEME_FALLBACK_COLOR;
  const luminance = relativeLuminance(normalised);
  const darkContrast = (luminance + 0.05) / (relativeLuminance("#111211") + 0.05);
  const lightContrast = 1.05 / (luminance + 0.05);
  return darkContrast >= lightContrast ? "#111211" : "#ffffff";
}

/**
 * Style d'un badge de thème : fond à la couleur du thème, texte contrasté.
 * Utilisé par le backoffice et, plus tard, par les pages publiques (WP16c/d).
 */
export function themeBadgeStyle(color?: string | null): {
  backgroundColor: string;
  color: string;
} {
  const normalised = normaliseThemeColor(color) ?? THEME_FALLBACK_COLOR;
  return { backgroundColor: normalised, color: themeTextColor(normalised) };
}
