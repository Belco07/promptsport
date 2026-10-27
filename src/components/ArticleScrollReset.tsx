"use client";

import { useEffect } from "react";

/**
 * Remet le lecteur en haut de page quand il passe d'un article à un autre
 * (blocs « À lire aussi », article précédent / suivant…).
 *
 * Next.js ne remonte pas toujours de lui-même : la page article a un écran de
 * chargement (`loading.tsx`) bien plus court qu'un article. Pendant la
 * transition, le navigateur raccourcit la page et la remonte un peu ; Next voit
 * alors le haut du contenu « déjà à l'écran » et ne fait plus défiler. Quand le
 * nouvel article arrive, le lecteur se retrouve au milieu de la page.
 *
 * Volontairement sans effet :
 * - au premier affichage (chargement ou rechargement de la page) ;
 * - sur « Précédent » / « Suivant » du navigateur, qui doivent retrouver la
 *   position laissée (Next la restaure) ;
 * - vers une ancre (`#…`), qui doit rester ciblée.
 */

/** Article affiché précédemment dans cet onglet (null au premier affichage). */
let previousSlug: string | null = null;
/** Heure du dernier « Précédent » / « Suivant » du navigateur. */
let lastHistoryNavigation = 0;

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    lastHistoryNavigation = Date.now();
  });
}

export function ArticleScrollReset({ slug }: { slug: string }) {
  useEffect(() => {
    const changedArticle = previousSlug !== null && previousSlug !== slug;
    previousSlug = slug;
    if (!changedArticle) return;
    if (Date.now() - lastHistoryNavigation < 1500) return;
    if (window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [slug]);

  return null;
}
