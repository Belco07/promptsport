/**
 * Design system — palette et typographie (WP9).
 *
 * Tailwind CSS v4 est installé dans ce projet : il se configure d'abord en CSS
 * (`@theme`), mais il sait toujours lire un fichier de configuration
 * JavaScript, à condition de le déclarer dans la feuille de style :
 *
 *     @config "../tailwind.config.js";   // dans src/app/globals.css
 *
 * C'est ce qui est fait ici : ce fichier reste la source unique de la palette et
 * des polices, conformément au brief WP9, et `theme.extend` préserve les
 * couleurs par défaut de Tailwind (gray, blue, amber, red…) dont dépendent les
 * espaces /studio et /backoffice, qui ne doivent pas changer d'apparence.
 */

/** Bleu profond : crédibilité, sérieux éditorial (ancre : #0F172A). */
const primary = {
  50: "#eef4ff",
  100: "#d9e5ff",
  200: "#b9d0ff",
  300: "#8bb0ff",
  400: "#5787fb",
  500: "#3161f0",
  600: "#1e46d6",
  700: "#1c3a8f",
  800: "#172b66",
  900: "#0f172a",
  950: "#080d18",
};

/** Orange vif : énergie, direct, accents (ancre : #F97316). */
const accent = {
  50: "#fff7ed",
  100: "#ffedd5",
  200: "#fed7aa",
  300: "#fdba74",
  400: "#fb923c",
  500: "#f97316",
  600: "#ea580c",
  700: "#c2410c",
  800: "#9a3412",
  900: "#7c2d12",
  950: "#431407",
};

/** Vert : réussite, victoire, statut « terminé » (ancre : #10B981). */
const success = {
  50: "#ecfdf5",
  100: "#d1fae5",
  200: "#a7f3d0",
  300: "#6ee7b7",
  400: "#34d399",
  500: "#10b981",
  600: "#059669",
  700: "#047857",
  800: "#065f46",
  900: "#064e3b",
  950: "#022c22",
};

/** Rouge : erreur, direct, défaite, annulation (ancre : #EF4444). */
const danger = {
  50: "#fef2f2",
  100: "#fee2e2",
  200: "#fecaca",
  300: "#fca5a5",
  400: "#f87171",
  500: "#ef4444",
  600: "#dc2626",
  700: "#b91c1c",
  800: "#991b1b",
  900: "#7f1d1d",
  950: "#450a0a",
};

/** Échelle de gris complète (50 → 950), base de toute la mise en page. */
const neutral = {
  50: "#f9fafb",
  100: "#f3f4f6",
  200: "#e5e7eb",
  300: "#d1d5db",
  400: "#9ca3af",
  500: "#6b7280",
  600: "#4b5563",
  700: "#374151",
  800: "#1f2937",
  900: "#111827",
  950: "#030712",
};

/**
 * Rouge éditorial : accent de l'identité publique (bandeau de une, rubriques,
 * liens actifs, appels à l'abonnement). L'orange `accent` reste employé par les
 * statuts et les messages d'attention.
 */
const brand = {
  50: "#fff1f2",
  100: "#ffe0e3",
  200: "#ffc7cd",
  300: "#ff9aa5",
  400: "#ff5c6e",
  500: "#df1830",
  600: "#c8172c",
  700: "#b81428",
  800: "#9c1223",
  900: "#7f0f1d",
  950: "#45070f",
};

/** Noirs et gris froids de la mise en page éditoriale (bandeaux, fil info). */
const ink = {
  50: "#f7f7f8",
  100: "#ededee",
  200: "#dedede",
  300: "#c8c8cc",
  400: "#888888",
  500: "#717171",
  600: "#626262",
  700: "#454c57",
  800: "#202326",
  900: "#191a1d",
  950: "#15181d",
};

/** Pile de repli si la police auto-hébergée n'est pas encore chargée. */
const fallbackSans = [
  "system-ui",
  "-apple-system",
  "Segoe UI",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
];

module.exports = {
  theme: {
    extend: {
      colors: { primary, accent, success, danger, neutral, brand, ink },

      fontFamily: {
        // `--font-inter` est posé par next/font dans src/app/layout.tsx.
        sans: ["var(--font-inter)", ...fallbackSans],
        // Titres : même famille, graisses plus fortes (700/800).
        display: ["var(--font-inter)", ...fallbackSans],
      },

      /**
       * Graisses intermédiaires de la maquette éditoriale : 750 pour les liens
       * et libellés, 850 pour les titres de une et de rubrique.
       */
      fontWeight: {
        strong: "750",
        heavy: "850",
      },

      // Ombres douces, réservées aux cartes et aux éléments survolés.
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        "card-hover": "0 10px 20px -8px rgb(15 23 42 / 0.18)",
      },

      // Largeur de lecture confortable pour le corps d'un article.
      maxWidth: {
        prose: "45rem", // 720 px
      },
    },
  },
};
