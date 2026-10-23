"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** One worker for offline reading and WP48 push. Registration never asks for permission. */
export function PwaClient() {
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    // Offline navigation needs an HTML document, not an unavailable Next RSC payload.
    const navigateOffline = (event: MouseEvent) => {
      if (navigator.onLine || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.hash) return;
      event.preventDefault(); event.stopImmediatePropagation(); location.assign(url.href);
    };
    document.addEventListener("click", navigateOffline, true);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); document.removeEventListener("click", navigateOffline, true); };
  }, []);
  useEffect(() => {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || /^\/(studio|backoffice|api|login|inscription|mon-compte)(\/|$)/.test(pathname)) return;
    let cancelled = false;
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const registration = await navigator.serviceWorker.ready;
        if (!cancelled && navigator.onLine) registration.active?.postMessage({ type: "CACHE_PUBLIC_PAGE", pathname });
      } catch { /* Online reading remains available if registration or storage fails. */ }
    };
    // Keep worker installation off the initial rendering path.
    const timer = window.setTimeout(() => void register(), 1200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pathname]);
  if (!offline) return null;
  return <p role="status" className="fixed inset-x-0 top-0 z-[100] bg-foreground px-4 py-2 text-center text-sm text-background">Hors connexion · Lecture sauvegardée. Les scores ne sont pas actualisés.</p>;
}
