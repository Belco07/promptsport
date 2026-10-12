"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Relit la page côté serveur à intervalle régulier pour suivre les scores en
 * direct, sans recharger le navigateur ni perdre le défilement. La relecture
 * est suspendue quand l'onglet est caché.
 */
export function LiveRefresh({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}
