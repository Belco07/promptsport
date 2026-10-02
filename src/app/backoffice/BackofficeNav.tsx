"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useMounted } from "@/lib/use-mounted";

/**
 * Navigation du backoffice. « Utilisateurs » est actif ; « Rôles » et
 * « Paramètres » restent des placeholders désactivés.
 *
 * L'état actif n'est appliqué qu'après montage (`useMounted`) : le serveur et le
 * premier rendu client produisent ainsi exactement le même HTML, même si l'URL
 * change pendant l'hydratation. Sans cette précaution, React signalait
 * « Hydration failed » et régénérait l'arbre — au risque de laisser les
 * interactions inertes.
 */
const PLACEHOLDERS = [
  { label: "Rôles" },
  { label: "Paramètres" },
];

export function BackofficeNav() {
  const pathname = usePathname();
  const mounted = useMounted();

  const linkClass = (active: boolean) =>
    `block rounded-md px-3 py-2 text-sm transition-colors ${
      active ? "bg-blue-700 font-medium text-white" : "text-gray-700 hover:bg-gray-100"
    }`;

  /** Lien actif seulement une fois monté : évite toute divergence d'hydratation. */
  const isActive = (test: boolean) => mounted && test;

  return (
    <nav className="space-y-1">
      <Link
        href="/backoffice"
        aria-current={isActive(pathname === "/backoffice") ? "page" : undefined}
        className={linkClass(isActive(pathname === "/backoffice"))}
      >
        Tableau de bord
      </Link>

      <Link
        href="/backoffice/users"
        aria-current={isActive(pathname.startsWith("/backoffice/users")) ? "page" : undefined}
        className={linkClass(isActive(pathname.startsWith("/backoffice/users")))}
      >
        Utilisateurs
      </Link>

      <Link
        href="/backoffice/sports"
        aria-current={isActive(pathname.startsWith("/backoffice/sports")) ? "page" : undefined}
        className={linkClass(isActive(pathname.startsWith("/backoffice/sports")))}
      >
        Sports
      </Link>

      <Link
        href="/backoffice/subscriptions"
        aria-current={isActive(pathname.startsWith("/backoffice/subscriptions")) ? "page" : undefined}
        className={linkClass(isActive(pathname.startsWith("/backoffice/subscriptions")))}
      >
        Abonnements
      </Link>

      <Link
        href="/backoffice/comments"
        aria-current={isActive(pathname.startsWith("/backoffice/comments")) ? "page" : undefined}
        className={linkClass(isActive(pathname.startsWith("/backoffice/comments")))}
      >
        Commentaires
      </Link>

      <Link
        href="/backoffice/newsletter"
        aria-current={isActive(pathname.startsWith("/backoffice/newsletter")) ? "page" : undefined}
        className={linkClass(isActive(pathname.startsWith("/backoffice/newsletter")))}
      >
        Newsletter
      </Link>

      <Link
        href="/backoffice/analytics"
        aria-current={isActive(pathname.startsWith("/backoffice/analytics")) ? "page" : undefined}
        className={linkClass(isActive(pathname.startsWith("/backoffice/analytics")))}
      >
        Analytics
      </Link>

      {PLACEHOLDERS.map((item) => (
        <span
          key={item.label}
          aria-disabled="true"
          className="block cursor-not-allowed rounded-md px-3 py-2 text-sm text-gray-400"
          title="Bientôt disponible"
        >
          {item.label}
        </span>
      ))}
    </nav>
  );
}
