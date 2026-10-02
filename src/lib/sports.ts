/**
 * Constantes sportives partagées (utilisables côté client et serveur).
 * Aucun import serveur ici : ce module est importé par des composants clients.
 */

export const SPORTS = [
  "football",
  "basketball",
  "tennis",
  "rugby",
  "autre",
] as const;

export type Sport = (typeof SPORTS)[number];

/** Compétitions synchronisées par défaut (Football-Data.org). */
export const DEFAULT_COMPETITIONS = ["PL", "PD", "BL1", "SA", "FL1", "CL"] as const;

/** Libellés lisibles des codes de compétition Football-Data.org. */
export const COMPETITION_LABELS: Record<string, string> = {
  PL: "Premier League",
  PD: "La Liga",
  BL1: "Bundesliga",
  SA: "Serie A",
  FL1: "Ligue 1",
  CL: "Champions League",
  DED: "Eredivisie",
  PPL: "Primeira Liga",
  ELC: "Championship",
  BSA: "Brasileirão Série A",
  WC: "Coupe du Monde",
  EC: "Euro",
};

/** Nom lisible d'un code de compétition. */
export function competitionLabel(code: string): string {
  return COMPETITION_LABELS[code] ?? code;
}
