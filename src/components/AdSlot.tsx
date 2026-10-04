/**
 * Emplacement publicitaire réservé.
 *
 * Ce composant ne charge **aucun** script de régie : il réserve la place. Le bloc
 * impose un ratio (celui du format demandé) plutôt qu'une hauteur en pixels : la
 * surface est ainsi identique à toutes les largeurs d'écran et aucun contenu ne se
 * décale le jour où une régie le remplit — c'est le point qui protège le CLS
 * mesuré au WP8c.
 *
 * Pour diffuser une annonce, remplacer le contenu de l'`<aside>` par l'`<ins>` ou
 * l'`<iframe>` du partenaire : la mise en page, elle, ne bouge pas.
 *
 * Le libellé « Publicité » est visible : la mention est obligatoire pour une
 * insertion commerciale, et elle rend la place explicite tant qu'aucune annonce
 * n'est servie. Le masquage pour les abonnés premium se fait avec `AdSlotGate`.
 */
const FORMATS = {
  /** Bandeau large (1838 × 340) : haut de page, sous un titre de section. */
  banner: { ratio: "aspect-[1838/340]", marker: "banner" },
  /** Encart latéral classique (300 × 250) : colonne de droite. */
  rectangle: { ratio: "aspect-[6/5]", marker: "rectangle" },
} as const;

export type AdFormat = keyof typeof FORMATS;

export function AdSlot({
  format = "banner",
  label = "Publicité",
  className = "",
}: {
  format?: AdFormat;
  label?: string;
  className?: string;
}) {
  const { ratio, marker } = FORMATS[format];

  return (
    <aside
      aria-label="Emplacement publicitaire"
      data-ad-slot={marker}
      className={`flex ${ratio} w-full items-start justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-100 ${className}`}
    >
      <span className="pt-3 text-[10px] font-semibold uppercase tracking-[2px] text-gray-500">
        {label}
      </span>
    </aside>
  );
}
