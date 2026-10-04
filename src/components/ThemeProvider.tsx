"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Fournisseur de thème (WP13a).
 *
 * Enveloppe l'application avec next-themes, qui :
 *  - pose la classe `dark` sur <html> (attribute="class", en accord avec
 *    `darkMode: "class"` de tailwind.config.js) ;
 *  - suit le thème du système quand l'utilisateur n'a rien choisi
 *    (`enableSystem`, `defaultTheme="system"`) et réagit à ses changements sans
 *    rechargement ;
 *  - mémorise le choix explicite (localStorage) ;
 *  - injecte un script dans le <head> qui applique le thème **avant** le premier
 *    rendu : c'est ce qui évite le flash de thème clair (FOUC) ;
 *  - `disableTransitionOnChange` évite qu'une transition CSS globale fasse
 *    « baver » les couleurs pendant la bascule.
 *
 * Le composant reste côté client : next-themes lit localStorage et matchMedia,
 * indisponibles au rendu serveur.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
