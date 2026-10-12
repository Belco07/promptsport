"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Award, Star, UserRound } from "lucide-react";
import { NotificationBadge } from "@/components/NotificationBadge";
type SessionUser = { name?: string | null; email?: string | null; isPremium?: boolean };

// Deduplicate session reads when the navigation and account control mount together.
let pendingSession: Promise<SessionUser | null> | null = null;
function readMenuSession() {
  if (!pendingSession) {
    pendingSession = fetch("/api/auth/session", { cache: "no-store" })
      .then(response => response.json()).then(session => session?.user ?? null)
      .catch(() => null).finally(() => { pendingSession = null; });
  }
  return pendingSession;
}

function useMenuUser() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    readMenuSession().then(session => { if (active) setUser(session); });
    return () => { active = false; };
  }, []);
  return user;
}

export function MonSportNavLink({ className = "" }: { className?: string }) {
  const user = useMenuUser();
  if (!user) return null;
  return <Link href="/mon-sport" className={`inline-flex items-center gap-2 ${className}`}><Star size={16} aria-hidden="true" />Mon Sport</Link>;
}

/**
 * Accès au compte dans l'en-tête.
 *
 * Un lecteur connecté est représenté par une **pastille ronde** contenant
 * l'icône de compte, sans son nom affiché. Les indicateurs sont posés sur la
 * pastille plutôt qu'à côté :
 *
 *  - **Premium** : petit badge icône (cadenas) en bas à gauche ;
 *  - **notifications non lues** : pastille de comptage en haut à droite.
 *
 * Le nom du lecteur et son statut d'abonné restent accessibles : `aria-label`
 * sur le lien et infobulle. La session est lue côté client
 * (`/api/auth/session`), donc le serveur rend un emplacement neutre — un
 * visiteur anonyme ne voit jamais « Se connecter » figé dans le HTML servi.
 */

/** Pastille ronde : l'icône seule, sans texte. */
const AVATAR_CLASS =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-foreground";

/** Badge icône posé sur la pastille (Premium, en bas à gauche). */
const OVERLAY_BADGE_CLASS =
  "absolute -bottom-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border border-status-premium-border bg-status-premium text-status-premium-foreground";

export function UserMenu({ showSportLink = true }: { showSportLink?: boolean }) {
  const user = useMenuUser();

  // Emplacement neutre pendant la lecture de la session (même gabarit que la pastille).
  if (user === undefined) return <span aria-hidden="true" className="inline-block h-9 w-9 shrink-0 rounded-full border border-border bg-muted" />;

  if (!user) {
    return <Link href="/login" className="inline-flex min-h-11 items-center gap-2 px-2 py-1.5 text-sm font-bold text-foreground hover:text-editorial-link"><span aria-hidden="true" className={AVATAR_CLASS}><UserRound className="h-5 w-5" /></span>Se connecter</Link>;
  }

  const label = user.name?.trim() || user.email?.trim() || "Mon compte";

  return <div className="flex flex-wrap items-center gap-2">
    {showSportLink && <Link href="/mon-sport" className="inline-flex min-h-11 items-center gap-2 px-2 py-1.5 text-sm font-bold text-foreground hover:text-editorial-link"><Star size={16} aria-hidden="true" />Mon Sport</Link>}
    <Link href="/mon-compte" aria-label={`Mon compte — ${label}${user.isPremium ? " (abonné premium)" : ""}`} title={label} className="inline-flex min-h-11 items-center px-2 py-1.5 text-sm font-bold text-foreground hover:text-editorial-link">
    <span className="relative inline-flex">
      <span aria-hidden="true" className={AVATAR_CLASS}><UserRound className="h-5 w-5" /></span>
      {user.isPremium && <span aria-hidden="true" className={OVERLAY_BADGE_CLASS}><Award className="h-3 w-3" /></span>}
      <span className="absolute -right-1.5 -top-1.5 flex items-center"><NotificationBadge /></span>
    </span>
  </Link></div>;
}
