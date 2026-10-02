"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useMounted } from "@/lib/use-mounted";

const LINKS = [
  { href: "/studio", label: "Tableau de bord" },
  { href: "/studio/articles", label: "Articles" },
  { href: "/studio/categories", label: "Catégories" },
];

/**
 * Navigation du studio. Comme celle du backoffice, elle n'applique l'état actif
 * qu'après montage : le HTML du serveur et le premier rendu client sont alors
 * identiques, ce qui évite les erreurs d'hydratation lorsque l'URL change
 * pendant le chargement de la page.
 */
export function StudioNav() {
  const pathname = usePathname();
  const mounted = useMounted();

  return (
    <nav className="space-y-1">
      {LINKS.map((link) => {
        const isActive =
          mounted &&
          (link.href === "/studio"
            ? pathname === "/studio"
            : pathname === link.href || pathname.startsWith(`${link.href}/`));

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={`block rounded-md px-3 py-2 text-sm transition-colors ${
              isActive
                ? "bg-blue-700 font-medium text-white"
                : "text-gray-700 hover:bg-gray-100"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
