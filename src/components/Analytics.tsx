"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Collecte analytics côté navigateur (WP8d).
 *
 * Un seul beacon `navigator.sendBeacon` par page vue, envoyé **après** l'événement
 * `load` : le tracking ne concurrence donc pas le chargement de l'image LCP.
 * Aucune dépendance externe, aucun impact sur le rendu (le composant rend null).
 */

/**
 * Espaces qui ne sont pas trackés côté client. La liste est dupliquée ici (et
 * non importée de `@/lib/analytics`) parce que ce module embarque Prisma, qui
 * n'a rien à faire dans un bundle navigateur ; la route de collecte applique de
 * toute façon le filtre qui fait foi.
 */
const PRIVATE_PREFIXES = ["/studio", "/backoffice", "/mon-compte", "/api", "/login", "/_next"];

function isPublicPath(pathname: string): boolean {
  return !PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isPublicPath(pathname)) return;

    const send = () => {
      const body = JSON.stringify({
        path: `${pathname}${window.location.search}`,
        referrer: document.referrer || null,
        screen: `${window.screen.width}x${window.screen.height}`,
      });

      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/analytics/track", new Blob([body], { type: "application/json" }));
        return;
      }

      void fetch("/api/analytics/track", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    };

    if (document.readyState === "complete") {
      send();
      return;
    }

    window.addEventListener("load", send, { once: true });
    return () => window.removeEventListener("load", send);
  }, [pathname]);

  return null;
}
