/**
 * Emplacement publicitaire réservé (bandeau).
 *
 * Ce composant ne charge **aucun** script de régie : il réserve la place. Le bloc
 * impose le ratio du bandeau de référence (1838 × 340) plutôt qu'une hauteur
 * fixe en pixels : la surface est ainsi identique à toutes les largeurs d'écran
 * et aucun contenu ne se décale le jour où une régie le remplit — c'est le point
 * qui protège le CLS mesuré au WP8c.
 *
 * Pour diffuser une annonce, remplacer le contenu de l'`<aside>` par l'`<ins>` ou
 * l'`<iframe>` du partenaire : la mise en page, elle, ne bouge pas.
 *
 * Le libellé « Publicité » est visible : la mention est obligatoire pour une
 * insertion commerciale, et elle rend la place explicite tant qu'aucune annonce
 * n'est servie.
 */
export function AdSlot({
  label = "Publicité",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <aside
      aria-label="Emplacement publicitaire"
      data-ad-slot="banner"
      className={`flex aspect-[1838/340] w-full items-start justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-100 ${className}`}
    >
      <span className="pt-3 text-[10px] font-semibold uppercase tracking-[2px] text-gray-500">
        {label}
      </span>
    </aside>
  );
}
