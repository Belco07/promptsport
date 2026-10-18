"use client";

import { ChevronDown } from "lucide-react";
import { NavSearch } from "@/components/NavSearch";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { MonSportNavLink, UserMenu } from "@/components/UserMenu";
import { useMounted } from "@/lib/use-mounted";

/**
 * Barre de navigation publique (WP9, identité éditoriale « news »).
 *
 * Logo à gauche, rubriques au centre (dont un menu déroulant Compétitions) et
 * bandeau « À suivre » des compétitions ; compte utilisateur à droite.
 *
 * WP33 : la barre est masquée sous 768 px (`hidden md:block`) — la navigation
 * mobile vit désormais dans `BottomNav` (barre fixe en bas d'écran) et dans le
 * tiroir « EN DIRECT », pour éviter les doublons. Le bouton burger et son
 * panneau, devenus inatteignables, ont été retirés.
 *
 * Ce composant reste le seul composant client du chrome public (desktop) : il
 * n'existe pas d'alternative serveur pour un menu déroulant. Les compétitions
 * lui sont fournies par le layout (composant serveur) : aucun chargement
 * différé, aucun appel réseau supplémentaire.
 *
 * Le layout racine enveloppe aussi /studio, /backoffice et /login : on masque
 * donc la barre sur ces routes pour ne pas polluer les espaces d'administration
 * (qui ont leur propre sidebar) ni la page de connexion.
 *
 * Tout le style passe par les jetons du design system (sémantiques
 * `foreground`, `muted`, `border`, `editorial-link`…) plutôt que par une
 * couche CSS dédiée.
 */

export type NavCompetition = { slug: string; name: string };

export function PublicNav({
  competitions = [],
  scoresBar = null,
  urgentBar = null,
}: {
  competitions?: NavCompetition[];
  /**
   * Bandeau de scores rendu par le serveur (layout) et inséré tout en haut.
   * Passé en `ReactNode` : un composant client ne peut pas importer un composant
   * serveur, et le bandeau doit hériter du masquage ci-dessous (il disparaît avec
   * la barre sur /login, /studio et /backoffice).
   */
  scoresBar?: React.ReactNode;
  /**
   * Bandeau urgent (fine barre au-dessus de l'en-tête), rendu par le layout :
   * même raison de passage en `ReactNode`, et même masquage sur les pages
   * techniques.
   */
  urgentBar?: React.ReactNode;
}) {
  const pathname = usePathname();
  // L'onglet actif n'est marqué qu'après montage : le HTML du serveur et le
  // premier rendu client sont ainsi identiques, même si l'URL change pendant
  // l'hydratation (erreur « Hydration failed » observée, qui laissait ensuite
  // les interactions de la page inertes).
  const mounted = useMounted();
  const [competitionsOpen, setCompetitionsOpen] = useState(false);
  const competitionsRef = useRef<HTMLDivElement>(null);

  // Referme le menu déroulant à chaque changement de page.
  useEffect(() => {
    setCompetitionsOpen(false);
  }, [pathname]);

  // Menu déroulant : fermeture au clic extérieur et sur Échap.
  useEffect(() => {
    if (!competitionsOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (competitionsRef.current && !competitionsRef.current.contains(event.target as Node)) {
        setCompetitionsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCompetitionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [competitionsOpen]);

  const isAdminOrLogin =
    pathname === "/login" ||
    pathname === "/inscription" ||
    pathname === "/bienvenue" ||
    /^\/(studio|backoffice)(\/|$)/.test(pathname);

  if (isAdminOrLogin) {
    return null;
  }

  const isActive = (href: string) =>
    mounted &&
    (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  /** Rubrique du menu : l'onglet actif est olive/lime, sans fond arrondi. */
  const linkClass = (href: string) =>
    [
      "editorial-nav-link px-3 py-2 text-sm font-strong transition-colors",
      isActive(href)
        ? "bg-muted text-editorial-link"
        : "text-foreground hover:bg-muted hover:text-editorial-link",
    ].join(" ");

  return (
    <>
      {/* Fine barre urgente, tout en haut (au-dessus de l'en-tête). */}
      {urgentBar}

      {/* Bandeau de scores, tout en haut des pages publiques (masqué avec la
          barre sur /login, /studio et /backoffice). */}
      {scoresBar}

      {/* WP33 : la barre est réservée au desktop — le mobile utilise la barre
          fixe `BottomNav` et le tiroir « EN DIRECT ». */}
      <header className="editorial-header sticky top-0 z-30 hidden border-b border-border border-t-4 border-t-editorial-link bg-background/95 backdrop-blur md:block">
      <nav
        aria-label="Navigation principale"
        className="relative mx-auto flex h-[55px] max-w-[1280px] items-center justify-between gap-4 px-4 max-[600px]:h-[44px]"
      >
        <Link
          href="/"
          className="editorial-logo flex shrink-0 items-center"
          aria-label="PromptSport — retour à l'accueil"
        >
          {/* Logo de la marque (fichier source 4361 px décliné en 900 px dans
              public/promptsport-logo.webp ; next/image sert la taille adaptée). */}
          <Image
            src="/promptsport-logo.webp"
            alt="PromptSport — L'actualité qui vibre, la passion qui déborde"
            width={900}
            height={198}
            priority
            className="editorial-logo-day h-10 w-auto max-[600px]:h-8"
          />
          <Image
            src="/promptsport-logo-night.png"
            alt="PromptSport — L'actualité qui vibre, la passion qui déborde"
            width={4739}
            height={1044}
            priority
            className="editorial-logo-night h-10 w-auto max-[600px]:h-8"
          />
        </Link>

        {/* Rubriques : affichées à partir de 768 px. */}
        <div className="hidden items-center gap-1 md:flex">
          <MonSportNavLink className={linkClass("/mon-sport")} />
          <Link href="/" className={linkClass("/")} aria-current={isActive("/") ? "page" : undefined}>
            Accueil
          </Link>
          <Link
            href="/scores"
            className={linkClass("/scores")}
            aria-current={isActive("/scores") ? "page" : undefined}
          >
            Scores
          </Link>

          <div className="relative" ref={competitionsRef}>
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={competitionsOpen}
              aria-controls="menu-competitions"
              onClick={() => setCompetitionsOpen((open) => !open)}
              className="editorial-nav-link inline-flex items-center gap-1 px-3 py-2 text-sm font-strong text-foreground transition-colors hover:bg-muted hover:text-editorial-link"
            >
              Compétitions
              <ChevronDown
                aria-hidden="true"
                className={`h-4 w-4 transition-transform ${competitionsOpen ? "rotate-180" : ""}`}
              />
            </button>

            {competitionsOpen ? (
              <div
                id="menu-competitions"
                className="animate-fade-up absolute left-0 z-40 mt-2 w-64 overflow-hidden border border-border bg-background py-1.5 shadow-lg"
              >
                {competitions.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-muted-foreground">
                    Aucune compétition suivie.
                  </p>
                ) : (
                  competitions.map((competition) => (
                    <Link
                      key={competition.slug}
                      href={`/competition/${competition.slug}`}
                      className="block px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:text-editorial-link"
                    >
                      {competition.name}
                    </Link>
                  ))
                )}
              </div>
            ) : null}
          </div>

          <Link
            href="/abonnement"
            className={linkClass("/abonnement")}
            aria-current={isActive("/abonnement") ? "page" : undefined}
          >
            Abonnement
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <NavSearch />
          {/* Sélecteur de thème (WP13a), à côté du compte. */}
          <ThemeToggle />

          {/* Compte utilisateur (desktop : la barre est masquée sur mobile). */}
          <UserMenu showSportLink={false} />
        </div>
      </nav>

      {/* Bandeau « À suivre » : accès direct aux compétitions suivies. */}
      {competitions.length > 0 ? (
        <nav aria-label="Accès rapide aux compétitions" className="editorial-competition-nav border-t border-border bg-background">
          <div className="mx-auto flex max-w-[1280px] items-center gap-[27px] overflow-x-auto whitespace-nowrap px-4 py-3 text-xs font-bold [scrollbar-width:thin] max-[600px]:gap-[22px] max-[600px]:py-2.5">
            <span className="text-[10px] uppercase tracking-[1px] text-editorial-link">À suivre</span>
            {competitions.map((competition) => {
              const active = mounted && pathname === `/competition/${competition.slug}`;
              return (
                <Link
                  key={competition.slug}
                  href={`/competition/${competition.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={active ? "text-editorial-link" : "transition-colors hover:text-editorial-link"}
                >
                  {competition.name}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}

      </header>
    </>
  );
}
