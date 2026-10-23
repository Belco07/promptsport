"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EntityLogo } from "@/components/EntityLogo";
import { ArrowRight, Home, Newspaper, Radio, Search, Star, User, X } from "@/components/icons";
import type { NavCompetition } from "@/components/PublicNav";
import { SocialLinks } from "@/components/SocialLinks";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * En-tête mobile (< 768 px), disposé comme la référence « Digital Haven » :
 *
 *  - ligne 1 (42 px) : bouton menu à trois traits de longueurs décroissantes à
 *    gauche, logo centré, bascule jour / nuit à droite ;
 *  - ligne 2 (43 px) : rubriques à défilement horizontal, avec icône ;
 *  - au clic sur le menu, l'icône devient une croix et un panneau s'ouvre sous
 *    l'en-tête : recherche, rubriques, compétitions, « Plus », puis réseaux.
 *
 * La barre de navigation du bas (`BottomNav`) reste en place.
 */
export function MobileHeader({ competitions }: { competitions: NavCompetition[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(85);
  const header = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Referme le menu à chaque changement de page.
  useEffect(() => setOpen(false), [pathname]);

  // Panneau ouvert : il démarre sous l'en-tête, la page derrière ne défile plus,
  // Échap le referme et rend le focus au bouton.
  useEffect(() => {
    if (!open) return;
    setPanelTop(header.current?.getBoundingClientRect().bottom ?? 85);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sections = [
    { href: "/", label: "Accueil", Icon: Home },
    { href: "/scores", label: "Scores", Icon: Radio },
    { href: "/archives", label: "Actualités", Icon: Newspaper },
    { href: "/mon-sport", label: "Mon Sport", Icon: Star },
  ];

  return (
    <header ref={header} className="editorial-header sticky top-0 z-30 border-b border-border bg-background md:hidden">
      <div className="relative flex h-[42px] items-center justify-between px-5">
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls="menu-mobile-panneau"
          aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
          onClick={() => setOpen((value) => !value)}
          className="flex h-[30px] w-[34px] items-center text-foreground"
        >
          {open ? (
            <X aria-hidden="true" size={24} />
          ) : (
            <span aria-hidden="true" className="flex flex-col gap-[5px]">
              <span className="block h-[2px] w-6 rounded-full bg-current" />
              <span className="block h-[2px] w-4 rounded-full bg-current" />
              <span className="block h-[2px] w-[10px] rounded-full bg-current" />
            </span>
          )}
        </button>

        <Link href="/" aria-label="PromptSport — retour à l'accueil" className="editorial-logo absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 !p-0">
          <Image src="/promptsport-logo.webp" alt="" width={900} height={198} priority className="editorial-logo-day h-[30px] w-auto" />
          <Image src="/promptsport-logo-night.png" alt="" width={4739} height={1044} priority className="editorial-logo-night h-[30px] w-auto" />
        </Link>

        <ThemeToggle />
      </div>

      {/* Rubriques à défilement horizontal, avec icône. */}
      <nav aria-label="Accès rapide" className="h-[43px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ul className="flex h-full items-stretch whitespace-nowrap">
          {competitions.map((competition) => (
            <li key={competition.slug}>
              <Link
                href={`/competition/${competition.slug}`}
                aria-current={pathname === `/competition/${competition.slug}` ? "page" : undefined}
                className="flex h-full items-center gap-2 px-[15px] text-sm font-medium text-foreground hover:text-editorial-link aria-[current=page]:text-editorial-link"
              >
                <EntityLogo kind="competition" name={competition.name} logoUrl={competition.logoUrl} slug={competition.slug} size={22} />
                {competition.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {open ? (
        <div
          id="menu-mobile-panneau"
          style={{ top: panelTop }}
          className="fixed inset-x-0 bottom-0 z-40 overflow-y-auto bg-background px-5 pb-28 pt-5 text-foreground"
        >
          <h2 className="text-sm font-bold">Rechercher</h2>
          <form action="/recherche" role="search" className="mt-3">
            <label htmlFor="menu-mobile-recherche" className="sr-only">Rechercher un article, un auteur, un mot-clé</label>
            <div className="flex h-11 items-center gap-2 rounded-full border border-border px-4 focus-within:ring-2 focus-within:ring-editorial-link">
              <Search aria-hidden="true" size={18} className="shrink-0 text-muted-foreground" />
              <input id="menu-mobile-recherche" name="q" type="search" minLength={2} placeholder="Article, auteur, mot-clé…" className="min-w-0 flex-1 bg-transparent text-sm outline-none !rounded-none" />
              <button type="submit" aria-label="Lancer la recherche" className="!min-h-0 shrink-0 p-1 text-muted-foreground">
                <ArrowRight aria-hidden="true" size={18} />
              </button>
            </div>
          </form>

          <h2 className="mt-8 border-b border-border pb-2 text-xs !font-normal text-muted-foreground">Rubriques</h2>
          <ul className="mt-2">
            {sections.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link href={href} className="flex items-center gap-3 py-2 text-[15px] hover:text-editorial-link">
                  <Icon aria-hidden="true" size={18} />
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          {competitions.length > 0 && (
            <>
              <h2 className="mt-6 border-b border-border pb-2 text-xs !font-normal text-muted-foreground">Compétitions</h2>
              <ul className="mt-2">
                {competitions.map((competition) => (
                  <li key={competition.slug}>
                    <Link href={`/competition/${competition.slug}`} className="flex items-center gap-3 py-2 text-[15px] hover:text-editorial-link">
                      <EntityLogo kind="competition" name={competition.name} logoUrl={competition.logoUrl} slug={competition.slug} size={22} />
                      {competition.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 className="mt-6 border-b border-border pb-2 text-xs !font-normal text-muted-foreground">Plus</h2>
          <ul className="mt-2">
            <li><Link href="/abonnement" className="block py-2 text-[15px] hover:text-editorial-link">Abonnement</Link></li>
            <li><Link href="/newsletter" className="block py-2 text-[15px] hover:text-editorial-link">Newsletter</Link></li>
            <li>
              <Link href="/mon-compte" className="flex items-center gap-3 py-2 text-[15px] hover:text-editorial-link">
                <User aria-hidden="true" size={18} />
                Mon compte
              </Link>
            </li>
          </ul>

          <div className="mt-8 flex items-center justify-between border-t border-dashed border-border pt-5">
            <h2 id="menu-mobile-suivez" className="text-sm font-bold">Suivez-nous</h2>
            <SocialLinks labelledBy="menu-mobile-suivez" />
          </div>
        </div>
      ) : null}
    </header>
  );
}
