"use client";

import { usePathname } from "next/navigation";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";

const pages: Record<string, BreadcrumbItem[]> = {
  "/scores": [{ label: "Scores", href: "/scores" }],
  "/live": [{ label: "Scores", href: "/scores" }, { label: "En direct", href: "/live" }],
  "/archives": [{ label: "Actualités", href: "/archives" }],
  "/themes": [{ label: "Thèmes", href: "/themes" }],
  "/recherche": [{ label: "Recherche", href: "/recherche" }],
  "/mon-sport": [{ label: "Mon Sport", href: "/mon-sport" }],
  "/newsletter": [{ label: "Newsletter", href: "/newsletter" }],
  "/abonnement": [{ label: "Abonnement", href: "/abonnement" }],
  "/abonnement/success": [{ label: "Abonnement", href: "/abonnement" }, { label: "Confirmation", href: "/abonnement/success" }],
  "/abonnement/cancel": [{ label: "Abonnement", href: "/abonnement" }, { label: "Paiement annulé", href: "/abonnement/cancel" }],
  "/mentions-legales": [{ label: "Mentions légales", href: "/mentions-legales" }],
  "/confidentialite": [{ label: "Confidentialité", href: "/confidentialite" }],
  "/login": [{ label: "Connexion", href: "/login" }],
  "/inscription": [{ label: "Inscription", href: "/inscription" }],
};

/** Static public routes. Entity pages supply their real database labels themselves. */
export function PublicBreadcrumbs() {
  const pathname = usePathname();
  const newsletterAction = pathname.match(/^\/newsletter\/(confirm|unsubscribe|preferences)\/[^/]+\/?$/);
  const actionLabel: Record<string, string> = { confirm: "Confirmation", unsubscribe: "Désinscription", preferences: "Préférences" };
  const items = newsletterAction ? [{ label: "Newsletter", href: "/newsletter" }, { label: actionLabel[newsletterAction[1]], href: "/newsletter" }] : pages[pathname.replace(/\/$/, "")];
  if (!items) return null;
  // No token, payment parameter or private query is ever copied into JSON-LD.
  const structuredData = !newsletterAction && !["/login", "/inscription", "/recherche", "/mon-sport", "/abonnement/success", "/abonnement/cancel"].includes(pathname);
  return <div className="mx-auto w-full max-w-[1280px] px-4 pt-5 md:px-6"><Breadcrumbs items={items} structuredData={structuredData} className="" /></div>;
}
