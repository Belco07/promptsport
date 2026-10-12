"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useMounted } from "@/lib/use-mounted";

const TABS = [
  { href: "/backoffice/sports/competitions", label: "Compétitions" },
  { href: "/backoffice/sports/teams", label: "Équipes" },
  { href: "/backoffice/sports/matches", label: "Matchs" },
];

/**
 * Onglets de la section Sports du backoffice, avec un bouton de synchronisation
 * en haut à droite (visible sur les trois onglets).
 *
 * L'onglet actif n'est marqué qu'après montage : c'est la même précaution que
 * dans les autres navigations, pour que le HTML du serveur et le premier rendu
 * client ne puissent pas diverger.
 */
export function SportTabs() {
  const pathname = usePathname();
  const mounted = useMounted();

  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b border-gray-200 [.public-site_&]:border-border">
      <nav className="flex gap-2">
        {TABS.map((tab) => {
          const isActive =
            mounted && (pathname === tab.href || pathname.startsWith(`${tab.href}/`));
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-blue-700 [.public-site_&]:border-editorial-link text-blue-700 [.public-site_&]:text-editorial-link"
                  : "border-transparent text-gray-600 [.public-site_&]:text-muted-foreground hover:border-gray-300 [.public-site_&]:hover:border-border hover:text-gray-900 [.public-site_&]:hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <Link
        href="/backoffice/sports/sync"
        className="mb-2 rounded-md bg-blue-700 [.public-site_&]:bg-primary px-4 py-2 text-sm font-medium text-white [.public-site_&]:text-primary-foreground transition-colors hover:bg-blue-800 [.public-site_&]:hover:bg-primary-hover"
      >
        Synchroniser les données
      </Link>
    </div>
  );
}
