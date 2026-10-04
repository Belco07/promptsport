"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";
import { useMounted } from "@/lib/use-mounted";

/**
 * Barre de navigation publique (WP9, identité éditoriale « news »).
 *
 * Logo à gauche, rubriques au centre (dont un menu déroulant Compétitions) et
 * bandeau « À suivre » des compétitions ; compte utilisateur à droite. Sous
 * 768 px, les rubriques et le compte sont repliés dans un panneau ouvert par le
 * bouton burger.
 *
 * Ce composant reste le seul composant client du chrome public : il n'existe
 * pas d'alternative serveur pour un menu déroulant et un panneau mobile. Les
 * compétitions lui sont fournies par le layout (composant serveur) : aucun
 * chargement différé, aucun appel réseau supplémentaire.
 *
 * Le layout racine enveloppe aussi /studio, /backoffice et /login : on masque
 * donc la barre sur ces routes pour ne pas polluer les espaces d'administration
 * (qui ont leur propre sidebar) ni la page de connexion.
 *
 * Tout le style passe par les jetons du design system (`brand`, `ink`,
 * `neutral`) plutôt que par une couche CSS dédiée.
 */

export type NavCompetition = { slug: string; name: string };

const NAV_LINKS = [
  { href: "/", label: "Accueil" },
  { href: "/scores", label: "Scores" },
  { href: "/abonnement", label: "Abonnement" },
];

export function PublicNav({
  competitions = [],
  scoresBar = null,
}: {
  competitions?: NavCompetition[];
  /**
   * Bandeau de scores rendu par le serveur (layout) et inséré tout en haut.
   * Passé en `ReactNode` : un composant client ne peut pas importer un composant
   * serveur, et le bandeau doit hériter du masquage ci-dessous (il disparaît avec
   * la barre sur /login, /studio et /backoffice).
   */
  scoresBar?: React.ReactNode;
}) {
  const pathname = usePathname();
  // L'onglet actif n'est marqué qu'après montage : le HTML du serveur et le
  // premier rendu client sont ainsi identiques, même si l'URL change pendant
  // l'hydratation (erreur « Hydration failed » observée, qui laissait ensuite
  // les interactions de la page inertes).
  const mounted = useMounted();
  const [burgerOpen, setBurgerOpen] = useState(false);
  const [competitionsOpen, setCompetitionsOpen] = useState(false);
  const competitionsRef = useRef<HTMLDivElement>(null);

  // Referme les panneaux à chaque changement de page.
  useEffect(() => {
    setBurgerOpen(false);
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
      if (event.key === "Escape") setCompetitionsOpen(false);
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
    pathname === "/studio" ||
    pathname.startsWith("/studio/") ||
    pathname === "/backoffice" ||
    pathname.startsWith("/backoffice/");

  if (isAdminOrLogin) {
    return null;
  }

  const isActive = (href: string) =>
    mounted &&
    (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

  /** Rubrique du menu : l'onglet actif est rouge, sans fond arrondi. */
  const linkClass = (href: string) =>
    [
      "px-3 py-2 text-sm font-strong transition-colors",
      isActive(href)
        ? "bg-brand-50 text-brand-600"
        : "text-neutral-700 hover:bg-neutral-100 hover:text-brand-600",
    ].join(" ");

  return (
    <>
      {/* Bandeau de scores, tout en haut des pages publiques (masqué avec la
          barre sur /login, /studio et /backoffice). */}
      {scoresBar}

      <header className="sticky top-0 z-30 border-b border-neutral-200 border-t-4 border-t-brand-500 bg-white/95 backdrop-blur">
      <nav
        aria-label="Navigation principale"
        className="mx-auto flex h-[82px] max-w-6xl items-center justify-between gap-4 px-4 max-[600px]:h-[66px]"
      >
        <Link
          href="/"
          className="flex shrink-0 items-center"
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
            className="h-10 w-auto max-[600px]:h-8"
          />
        </Link>

        {/* Rubriques : affichées à partir de 768 px. */}
        <div className="hidden items-center gap-1 md:flex">
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
              className="inline-flex items-center gap-1 px-3 py-2 text-sm font-strong text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-brand-600"
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
                className="absolute left-0 z-40 mt-2 w-64 overflow-hidden border border-neutral-200 bg-white py-1.5 shadow-lg"
              >
                {competitions.length === 0 ? (
                  <p className="px-4 py-2 text-sm text-neutral-500">
                    Aucune compétition suivie.
                  </p>
                ) : (
                  competitions.map((competition) => (
                    <Link
                      key={competition.slug}
                      href={`/competition/${competition.slug}`}
                      className="block px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-brand-50 hover:text-brand-600"
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
          {/* Sélecteur de thème (WP13a), à côté du compte. */}
          <ThemeToggle />

          {/* Compte : sur mobile, il est replié dans le panneau burger. */}
          <div className="hidden md:block">
            <UserMenu />
          </div>

          <button
            type="button"
            className="inline-flex items-center justify-center border border-neutral-300 p-2 text-neutral-700 transition-colors hover:bg-neutral-100 md:hidden"
            aria-expanded={burgerOpen}
            aria-controls="menu-mobile"
            aria-label={burgerOpen ? "Fermer le menu" : "Ouvrir le menu"}
            onClick={() => setBurgerOpen((open) => !open)}
          >
            {burgerOpen ? (
              <X aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Menu aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>
      </nav>

      {/* Bandeau « À suivre » : accès direct aux compétitions suivies. */}
      {competitions.length > 0 ? (
        <nav aria-label="Accès rapide aux compétitions" className="border-t border-ink-100 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-[27px] overflow-x-auto whitespace-nowrap px-4 py-3 text-xs font-bold [scrollbar-width:thin] max-[600px]:gap-[22px] max-[600px]:py-2.5">
            <span className="text-[10px] uppercase tracking-[1px] text-brand-600">À suivre</span>
            {competitions.map((competition) => {
              const active = pathname === `/competition/${competition.slug}`;
              return (
                <Link
                  key={competition.slug}
                  href={`/competition/${competition.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={active ? "text-brand-600" : "transition-colors hover:text-brand-600"}
                >
                  {competition.name}
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}

      {burgerOpen ? (
        <div
          id="menu-mobile"
          className="border-t border-neutral-200 bg-white px-4 pb-5 pt-3 md:hidden"
        >
          <ul className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`block px-3 py-2.5 text-base font-semibold ${
                    isActive(link.href)
                      ? "bg-brand-50 text-brand-600"
                      : "text-neutral-800 hover:bg-neutral-100"
                  }`}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-4 px-3 text-xs font-bold uppercase tracking-wider text-neutral-500">
            Compétitions
          </p>
          <ul className="mt-1 flex flex-col">
            {competitions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-neutral-500">Aucune compétition suivie.</li>
            ) : (
              competitions.map((competition) => (
                <li key={competition.slug}>
                  <Link
                    href={`/competition/${competition.slug}`}
                    className="block px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
                  >
                    {competition.name}
                  </Link>
                </li>
              ))
            )}
          </ul>

          <div className="mt-4 border-t border-neutral-200 pt-4">
            <UserMenu />
          </div>

          <div className="mt-3">
            <ThemeToggle />
          </div>
        </div>
      ) : null}
      </header>
    </>
  );
}
