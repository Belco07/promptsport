"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Bloc de commentaires repliable, comme la référence « Digital Haven » : fermé
 * par défaut derrière un bouton arrondi. Il s'ouvre aussi tout seul quand on
 * arrive par le lien `#commentaires` (rail de partage, notification…), y
 * compris sur les navigateurs qui n'ouvrent pas un <details> à l'ancre.
 */
export function CommentsDisclosure({
  defaultOpen,
  summary,
  children,
}: {
  defaultOpen: boolean;
  summary: ReactNode;
  children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash === "#commentaires" && details.current) details.current.open = true;
    };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
  }, []);
  return (
    <details ref={details} open={defaultOpen} className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      {children}
    </details>
  );
}
