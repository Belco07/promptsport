"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { logout } from "@/app/studio/logout-action";
import { NotificationBadge } from "@/components/NotificationBadge";
import { PremiumBadge } from "@/components/PremiumBadge";

/**
 * Menu utilisateur de la barre de navigation publique (WP7d/WP7e).
 *
 * Depuis le WP7e, la session Auth.js expose `role` et `isPremium` : plus besoin
 * d'une Server Action, on lit /api/auth/session (le jeton est rafraîchi
 * périodiquement côté serveur, donc le badge apparaît sans reconnexion).
 */
type SessionUser = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  isPremium?: boolean;
};

export function UserMenu() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session) => {
        if (active) setUser(session?.user ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      });
    return () => {
      active = false;
    };
  }, []);

  // Fermeture du menu au clic extérieur et sur Échap.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (user === undefined) {
    return <span aria-hidden="true" className="inline-block h-8 w-28" />;
  }

  if (user === null) {
    return (
      <Link
        href="/login"
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
      >
        Se connecter
      </Link>
    );
  }

  const isAdmin = user.role === "ADMIN";
  const displayName = user.name ?? user.email ?? "mon compte";
  const initial = displayName.trim().charAt(0).toUpperCase();

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
      >
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-xs font-semibold text-white"
        >
          {initial}
        </span>
        <span className="max-w-[9rem] truncate">{displayName}</span>
        {user.isPremium ? <PremiumBadge /> : null}
        {/* Compteur de notifications non lues (WP10d) : visible sans ouvrir le menu. */}
        <NotificationBadge />
        <span aria-hidden="true" className="text-xs text-gray-400">
          ▾
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          <p className="truncate px-3 py-2 text-xs text-gray-500">{user.email}</p>

          <Link
            role="menuitem"
            href="/mon-compte"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-100"
          >
            Mon compte
          </Link>
          <Link
            role="menuitem"
            href="/mon-compte/abonnement"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-100"
          >
            Mon abonnement
          </Link>
          <Link
            role="menuitem"
            href="/mon-compte/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-100"
          >
            <span>Notifications</span>
            <NotificationBadge />
          </Link>
          <Link
            role="menuitem"
            href={isAdmin ? "/backoffice" : "/studio"}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-gray-800 transition-colors hover:bg-gray-100"
          >
            {isAdmin ? "Backoffice" : "Mon studio"}
          </Link>

          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100"
            >
              Se déconnecter
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
