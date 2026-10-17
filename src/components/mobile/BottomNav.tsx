"use client";

import { Activity, Home, Search, Star, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useMounted } from "@/lib/use-mounted";

/**
 * Barre de navigation mobile (WP33).
 *
 * Expérience mobile-first : sous 768 px, la navigation quitte l'en-tête
 * (`PublicNav` y est masqué) pour cette barre fixe en bas d'écran, à portée de
 * pouce. Cinq destinations essentielles : Accueil, Scores, Mon Club, Recherche
 * et Compte.
 *
 * - La barre reste masquée à partir de 768 px (`md:hidden`) : aucun changement
 *   fonctionnel sur desktop.
 * - Elle s'adosse aux zones sûres iOS (`env(safe-area-inset-bottom)`) et
 *   réserve l'espace correspondant en fin de flux (`--mobile-nav-height`), pour
 *   que le dernier contenu d'une page ne passe jamais dessous.
 * - L'onglet actif n'est marqué qu'après montage (voir `use-mounted`, WP11f) :
 *   le HTML du serveur et le premier rendu client restent identiques.
 * - Comme `PublicNav`, elle disparaît sur les pages techniques (admin,
 *   connexion) et sur `/mon-compte` (espace abonné plein écran).
 */

const ITEMS = [
  { href: "/", label: "Accueil", icon: Home },
  { href: "/scores", label: "Scores", icon: Activity },
  { href: "/mon-sport", label: "Mon Club", icon: Star },
  { href: "/recherche", label: "Recherche", icon: Search },
  { href: "/mon-compte", label: "Compte", icon: User },
] as const;

/** Pages techniques (admin, connexion) et espace abonné : la barre y disparaît. */
const HIDDEN_ROUTES =
  /^\/(login|inscription|bienvenue|mon-compte)(\/|$)|^\/(studio|backoffice)(\/|$)/;

export function BottomNav() {
  const pathname = usePathname();
  const mounted = useMounted();

  if (HIDDEN_ROUTES.test(pathname)) {
    return null;
  }

  const isActive = (href: string) =>
    mounted && (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      {/* Réserve d'espace en fin de flux : le dernier contenu de la page ne
          passe pas sous la barre fixe (équivalent d'un `pb-20` sur le <main>,
          qui vit dans chaque page et n'est pas modifié). */}
      <div aria-hidden="true" className="h-[var(--mobile-nav-height)] md:hidden" />

      <nav
        role="navigation"
        aria-label="Navigation mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto flex max-w-xl items-stretch">
          {ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-bold leading-none transition-colors ${
                    active ? "text-editorial-link" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {/* Onglet actif : filet lime (--accent) et libellé éditorial.
                      Le texte reste `editorial-link` (olive sur clair, lime sur
                      sombre) : du lime plein sur fond blanc échouerait le
                      contraste WCAG. */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-3 top-0 h-0.5 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                  />
                  <Icon aria-hidden="true" className="h-5 w-5" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
