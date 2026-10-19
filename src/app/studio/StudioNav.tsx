"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { useMounted } from "@/lib/use-mounted";

const LINKS = [
  { href: "/studio", label: "Tableau de bord" },
  { href: "/studio/articles", label: "Articles" },
  { href: "/studio/une", label: "Une" },
  { href: "/studio/categories", label: "Catégories" },
];

/**
 * Navigation du studio. Comme celle du backoffice, elle n'applique l'état actif
 * qu'après montage : le HTML du serveur et le premier rendu client sont alors
 * identiques, ce qui évite les erreurs d'hydratation lorsque l'URL change
 * pendant le chargement de la page.
 */
export function StudioNav({ liveMatchId }: { liveMatchId?: string }) {
  const pathname = usePathname();
  const mounted = useMounted();
  const [canManageFeatured, setCanManageFeatured] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/auth/session").then(response => response.json()).then(session => {
      if (active) setCanManageFeatured(["ADMIN", "EDITOR"].includes(session?.user?.role));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  return (
    <nav className="space-y-1">
      {liveMatchId && (
        <Link
          href={`/studio/live/${liveMatchId}`}
          aria-current={pathname === `/studio/live/${liveMatchId}` ? "page" : undefined}
          className={`block rounded-md px-3 py-2 text-sm transition-colors ${
            pathname === `/studio/live/${liveMatchId}`
              ? "bg-primary font-medium text-white"
              : "text-foreground hover:bg-muted"
          }`}
        >
          Studio Live
        </Link>
      )}
      {LINKS.map((link) => {
        if (link.href === "/studio/une" && !canManageFeatured) return null;
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
                ? "bg-primary font-medium text-white"
                : "text-foreground hover:bg-muted"
            }`}
          >
            {link.href === "/studio/une" && <Star aria-hidden="true" className="mr-2 inline h-4 w-4" />}{link.label}
          </Link>
        );
      })}
    </nav>
  );
}
