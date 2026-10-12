/**
 * Thèmes éditoriaux par défaut — source unique (WP16a, mis à jour au WP20).
 *
 * Ce module est partagé par :
 *   - `prisma/seed.cjs` (développement : compte de test + thèmes) ;
 *   - `prisma/seed-themes.cjs` (production : thèmes uniquement).
 *
 * Il ne contient aucune donnée sensible et ne dépend d'aucune bibliothèque :
 * c'est un simple module CommonJS, chargeable par les deux scripts comme par un
 * test.
 *
 * WP20 : « Transferts » recouvrait « Mercato » → conservé mais `active: false`
 * (l'historique est préservé), et quatre thèmes à fort engagement sont ajoutés.
 */

module.exports = [
  {
    name: "Mercato",
    slug: "mercato",
    description: "Rumeurs, négociations et mouvements du marché des transferts.",
    color: "#d7ff00",
    icon: "Repeat",
    active: true,
  },
  {
    name: "Tactique",
    slug: "tactique",
    description: "Analyses de jeu, schémas et choix des entraîneurs.",
    color: "#3b82f6",
    icon: "ClipboardList",
    active: true,
  },
  {
    name: "Interviews",
    slug: "interviews",
    description: "Entretiens, confidences et prises de parole.",
    color: "#a855f7",
    icon: "Mic",
    active: true,
  },
  {
    name: "Compétitions",
    slug: "competitions",
    description: "Championnats, coupes et rendez-vous internationaux.",
    color: "#f59e0b",
    icon: "Trophy",
    active: true,
  },
  {
    name: "Transferts",
    slug: "transferts",
    description: "Transferts officialisés et mouvements de joueurs (thème fusionné avec Mercato).",
    color: "#10b981",
    icon: "ArrowLeftRight",
    active: false,
  },
  {
    name: "Blessures",
    slug: "blessures",
    description: "Blessures, indisponibilités et retours à la compétition.",
    color: "#ef4444",
    icon: "HeartPulse",
    active: true,
  },
  {
    name: "Polémiques",
    slug: "polemiques",
    description: "Controverses, décisions litigieuses et débats qui agitent le sport.",
    color: "#f97316",
    icon: "Flame",
    active: true,
  },
  {
    name: "Power Ranking",
    slug: "power-ranking",
    description: "Classements de forme : qui monte, qui descend, qui domine.",
    color: "#8b5cf6",
    icon: "TrendingUp",
    active: true,
  },
  {
    name: "Opinion",
    slug: "opinion",
    description: "Éditos, tribunes et points de vue de la rédaction.",
    color: "#0ea5e9",
    icon: "MessageSquareQuote",
    active: true,
  },
];
