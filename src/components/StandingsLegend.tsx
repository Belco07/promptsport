export type StandingsRules = {
  uclSpots: number;
  uelSpots: number;
  ueclSpots: number;
  relegationSpots: number;
  relegationPlayoffSpots: number;
  format: "LEAGUE" | "CUP_PHASE";
};

export const NEUTRAL_STANDINGS_RULES: StandingsRules = {
  uclSpots: 0, uelSpots: 0, ueclSpots: 0, relegationSpots: 0, relegationPlayoffSpots: 0, format: "LEAGUE",
};

export const STANDINGS_ZONES = {
  ucl: { name: "Ligue des Champions", description: "Place en Ligue des Champions", logo: 2, row: "hover:bg-standing-ucl dark:hover:bg-standing-ucl-night", badge: "bg-standing-ucl text-standing-ucl-ink", border: "border-l-ucl", dot: "bg-ucl" },
  uel: { name: "Ligue Europa", description: "Place en Ligue Europa", logo: 3, row: "hover:bg-standing-uel dark:hover:bg-standing-uel-night", badge: "bg-standing-uel text-standing-uel-ink", border: "border-l-uel", dot: "bg-uel" },
  uecl: { name: "Conference League", description: "Place en Conference League", logo: 848, row: "hover:bg-standing-uecl dark:hover:bg-standing-uecl-night", badge: "bg-standing-uecl text-standing-uecl-ink", border: "border-l-uecl", dot: "bg-uecl" },
  barrage: { name: "Barrage", description: "Barrage de maintien", logo: null, row: "hover:bg-standing-barrage dark:hover:bg-standing-barrage-night", badge: "bg-standing-barrage text-standing-barrage-ink", border: "border-l-barrage", dot: "bg-barrage" },
  relegation: { name: "Relégation", description: "Relégation directe", logo: null, row: "hover:bg-standing-relegation dark:hover:bg-standing-relegation-night", badge: "bg-standing-relegation text-standing-relegation-ink", border: "border-l-relegation", dot: "bg-relegation" },
} as const;
export type StandingsZone = keyof typeof STANDINGS_ZONES;

const spots = (count: number) => Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

/** Positions are 1-based. Direct relegation always occupies the last places. */
export function standingsZone(position: number, total: number, rules: StandingsRules): StandingsZone | null {
  if (rules.format === "CUP_PHASE" || position < 1 || position > total) return null;
  const relegation = spots(rules.relegationSpots), playoff = spots(rules.relegationPlayoffSpots);
  if (position > total - relegation) return "relegation";
  if (position > total - relegation - playoff) return "barrage";
  const ucl = spots(rules.uclSpots), uel = spots(rules.uelSpots), uecl = spots(rules.ueclSpots);
  if (position <= ucl) return "ucl";
  if (position <= ucl + uel) return "uel";
  if (position <= ucl + uel + uecl) return "uecl";
  return null;
}

export function StandingsLegend({ rules }: { rules: StandingsRules }) {
  if (rules.format === "CUP_PHASE") return <p className="mt-4 text-sm text-muted-foreground">Classement de la phase de ligue — pas de relégation</p>;
  const counts: Record<StandingsZone, number> = { ucl: spots(rules.uclSpots), uel: spots(rules.uelSpots), uecl: spots(rules.ueclSpots), barrage: spots(rules.relegationPlayoffSpots), relegation: spots(rules.relegationSpots) };
  const zones = (Object.keys(counts) as StandingsZone[]).filter(zone => counts[zone] > 0);
  if (!zones.length) return null;
  return <div className="mt-4 text-sm text-foreground">
    <ul aria-label="Légende du classement" className="flex flex-wrap gap-x-6 gap-y-2">{zones.map(zone => <li key={zone} className="flex items-center gap-2"><span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${STANDINGS_ZONES[zone].dot}`} /><span>{STANDINGS_ZONES[zone].name} ({counts[zone]} place{counts[zone] > 1 ? "s" : ""})</span></li>)}</ul>
    <p className="mt-3 text-xs text-muted-foreground">Repères de places configurés pour cette compétition. Les coupes nationales, tours préliminaires et places supplémentaires peuvent modifier les qualifications européennes.</p>
  </div>;
}
