"use client";

import { useEffect, useState } from "react";

/**
 * Vrai une fois le composant monté côté navigateur (WP11f — correctif
 * d'hydratation).
 *
 * Plusieurs composants de navigation décoraient leur lien actif à partir de
 * `usePathname()` : le serveur rendait donc `aria-current="page"` et les classes
 * du lien actif, tandis que le navigateur pouvait hydrater avec une autre URL.
 * C'est possible dès que l'URL change avant la fin de l'hydratation — un clic sur
 * un lien pendant que la page se charge, ou un préchargement — et React signale
 * alors « Hydration failed because the server rendered text didn't match the
 * client », avant de régénérer l'arbre entier : les interactions de la page
 * (dont le lien « Répondre ») pouvaient rester inertes.
 *
 * Le remède consiste à rendre le premier passage identique des deux côtés
 * (aucun lien actif) puis à appliquer l'état actif après montage. Le repère
 * visuel apparaît alors un instant après le premier rendu, ce qui est le prix
 * d'une hydratation fiable ; sans JavaScript, la navigation reste fonctionnelle,
 * seul le repère est absent.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
