"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, UserRound, X } from "@/components/icons";
import { logout } from "@/app/studio/logout-action";

/**
 * Coquille de l'espace abonné : deux colonnes, le menu à gauche sur toute la
 * hauteur de l'écran et le contenu à droite. L'en-tête du site est masqué sur
 * ces pages ; la croix en haut à droite du menu permet de quitter l'espace.
 */
export function WorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<{ name?: string; role?: string } | null>(null);

  useEffect(() => { let active = true; fetch("/api/auth/session", { cache: "no-store" }).then(r => r.json()).then(s => { if (active) setUser(s.user ?? null); }).catch(() => {}); return () => { active = false; }; }, []);

  // Menu du lecteur : seules les rubriques publiques.
  const entries = [
    { label: "Détails du compte", href: "/mon-compte" },
    { label: "Favoris", href: "/mon-compte/favoris" },
    { label: "Préférences", href: "/mon-compte/preferences" },
    { label: "Mon abonnement", href: "/mon-compte/abonnement" },
    { label: "Notifications", href: "/mon-compte/notifications" },
  ];
  // Rubriques réservées à l'équipe : un lecteur ne les voit jamais.
  const staffEntries = [
    ...(["ADMIN", "EDITOR", "JOURNALIST"].includes(user?.role ?? "") ? [{ label: "Mon studio", href: "/studio" }] : []),
    ...(user?.role === "ADMIN" ? [{ label: "Backoffice", href: "/backoffice" }] : []),
  ];

  return <div className="workspace-theme grid min-h-dvh w-full md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
    <aside className="flex flex-col border-b border-border px-6 py-8 md:sticky md:top-0 md:h-dvh md:self-start md:overflow-y-auto md:border-b-0 md:border-r md:px-8 xl:px-10">
      <p className="flex min-w-0 items-center gap-3 pr-16 pt-2 text-xl font-bold text-editorial-link md:pr-0">
        <UserRound size={22} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{user?.name ?? "Mon compte"}</span>
      </p>
      <nav aria-label="Menu du compte" className="mt-8 space-y-1">{entries.map(entry => {
        const active = entry.href === "/mon-compte" ? pathname === entry.href : pathname === entry.href || pathname.startsWith(entry.href + "/");
        return <Link key={entry.href} href={entry.href} aria-current={active ? "page" : undefined} className={`flex items-center justify-between gap-3 rounded-md py-3 text-lg font-semibold ${active ? "text-editorial-link" : "text-foreground hover:text-editorial-link"}`}>{entry.label}<ChevronRight size={20} className="shrink-0" aria-hidden="true" /></Link>;
      })}</nav>
      {/* Déconnexion ancrée en bas de la colonne, qui fait la hauteur de l'écran. */}
      <form action={logout} className="mt-auto pt-6"><button type="submit" className="app-button w-full bg-primary px-5 py-3 font-bold text-primary-foreground">Se déconnecter</button></form>
    </aside>

    <div className="workspace-content min-w-0 px-4 pb-12 sm:px-8">
      {/* Rubriques d'équipe : plus petites, en haut à droite du contenu. */}
      {staffEntries.length > 0 ? <div className="mt-4 flex h-12 flex-wrap items-center justify-end gap-x-5 pr-20 sm:pr-24">{staffEntries.map(entry => <Link key={entry.href} href={entry.href} className="text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-editorial-link">{entry.label}</Link>)}</div> : null}
      {children}
    </div>

    {/* Croix de fermeture : en haut à droite de l'écran. */}
    <Link href="/" aria-label="Quitter mon compte et revenir à l'accueil" title="Quitter mon compte" className="fixed right-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:border-accent hover:text-editorial-link sm:right-8 sm:top-8">
      <X size={24} aria-hidden="true" />
    </Link>
  </div>;
}
