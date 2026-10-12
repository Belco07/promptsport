"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { WorkspaceFrame } from "@/components/WorkspaceFrame";

/** Scope the editorial skin to the reader-facing site. */
export function PublicShell({ children, header }: { children: ReactNode; header: ReactNode }) {
  const pathname = usePathname();
  const authPage = /^\/(login|inscription|bienvenue)(\/|$)/.test(pathname);
  const workspace = /^\/mon-compte(\/|$)/.test(pathname);
  // L'espace abonné se passe d'en-tête : le menu occupe toute la hauteur de
  // l'écran et sa croix permet de revenir au site.
  return <div className={authPage ? undefined : "public-site"}>{workspace ? <WorkspaceFrame>{children}</WorkspaceFrame> : <>{header}{children}</>}</div>;
}
