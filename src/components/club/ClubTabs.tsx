import Link from "next/link";

export const clubTabs = {
  actualites: "Actualités",
  calendrier: "Calendrier",
  resultats: "Résultats",
  effectif: "Effectif",
  stats: "Stats",
  rivalites: "Rivalités",
};
export type ClubTab = keyof typeof clubTabs;

/**
 * Onglets de rubriques d'un club (WP34).
 *
 * Quand `accentColor` est fourni (couleur hex de la compétition du club), il
 * remplace le bleu primaire par défaut pour la bordure de l'onglet actif.
 */
export function ClubTabs({
  slug,
  active,
  accentColor,
}: {
  slug: string;
  active: ClubTab;
  accentColor?: string;
}) {
  const activeBorder = accentColor ? `border-[#${accentColor}]` : "border-primary";
  const activeText = accentColor ? `text-[#${accentColor}]` : "text-editorial-link";
  return (
    <nav aria-label="Rubriques du club" className="my-8 flex gap-6 overflow-x-auto border-b border-border">
      {Object.entries(clubTabs).map(([key, label]) => (
        <Link
          key={key}
          href={`/club/${slug}?tab=${key}`}
          aria-current={active === key ? "page" : undefined}
          className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 pb-4 font-bold focus-visible:outline-2 focus-visible:outline-offset-4 ${active === key ? `${activeBorder} ${activeText}` : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
