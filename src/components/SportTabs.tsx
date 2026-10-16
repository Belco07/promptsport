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
 * Onglets de la section Sports du backoffice.
 *
 * L'onglet actif n'est marqué qu'après montage : c'est la même précaution que
 * dans les autres navigations, pour que le HTML du serveur et le premier rendu
 * client ne puissent pas diverger.
 *
 * WP30 : le bouton « Synchroniser les données » a été retiré avec la page
 * dépréciée /backoffice/sports/sync qu'il ouvrait.
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
    </div>
  );
}
