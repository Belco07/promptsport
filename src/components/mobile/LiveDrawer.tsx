"use client";

import { ChevronUp, X } from "@/components/icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { LiveBadge } from "@/components/LiveBadge";
import { MatchCard, type MatchCardData } from "@/components/MatchCard";

/**
 * Tiroir « EN DIRECT » mobile (WP33).
 *
 * Un bouton flottant n'apparaît sur mobile que s'il y a des matchs en direct ;
 * il ouvre un tiroir qui coulisse depuis le bas (translate-y) et liste les
 * scores (cartes `MatchCard` en version compacte, logos via le proxy WP30).
 *
 * - Données : fournies par le layout (composant serveur, cache 30 s) puis
 *   relues via une Server Action légère à l'ouverture, et une fois par minute
 *   tant que l'onglet est visible — pas de WebSocket.
 * - Accessibilité : le tiroir est un `role="dialog"` modal qui capture le focus
 *   à l'ouverture (focus posé sur le bouton de fermeture), piège la tabulation,
 *   se ferme sur Échap, au clic sur l'arrière-plan ou sur le bouton Fermer, et
 *   rend le focus au bouton flottant à la fermeture.
 * - Aucune bibliothèque : transition CSS pure, pas de `showModal` (le tiroir
 *   doit rester monté pour l'animation de sortie).
 */

/** Match affiché par le tiroir : même contrat que les cartes de /scores. */
export type LiveDrawerMatch = MatchCardData;

/** Mêmes exclusions que `PublicNav` et `BottomNav`. */
const HIDDEN_ROUTES =
  /^\/(login|inscription|bienvenue|mon-compte)(\/|$)|^\/(studio|backoffice)(\/|$)/;

export function LiveDrawer({
  initialMatches,
  refreshAction,
}: {
  initialMatches: LiveDrawerMatch[];
  /**
   * Server Action (définie dans le layout) : relit les matchs en direct.
   * Appelée à l'ouverture du tiroir et par la relecture silencieuse.
   */
  refreshAction: () => Promise<LiveDrawerMatch[]>;
}) {
  const pathname = usePathname();
  const [matches, setMatches] = useState(initialMatches);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Les données du serveur font foi à chaque navigation (le layout est relu).
  useEffect(() => {
    setMatches(initialMatches);
  }, [initialMatches]);

  // Referme le tiroir à chaque changement de page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Relecture silencieuse (mobile uniquement, onglet visible, tiroir fermé) :
  // le bouton apparaît ainsi quand un match passe en direct, sans rechargement.
  useEffect(() => {
    if (!window.matchMedia("(max-width: 767px)").matches || HIDDEN_ROUTES.test(pathname)) return;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible" || open) return;
      try {
        setMatches(await refreshAction());
      } catch {
        /* Réseau indisponible : on conserve l'affichage courant. */
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [open, pathname, refreshAction]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setMatches(await refreshAction());
    } catch {
      /* Réseau indisponible : on conserve l'affichage courant. */
    } finally {
      setRefreshing(false);
    }
  }, [refreshAction]);

  const openDrawer = () => {
    setEverOpened(true);
    setOpen(true);
    void refresh();
  };

  const closeDrawer = useCallback(() => {
    setOpen(false);
    // Rend le focus au déclencheur (WCAG 2.4.3).
    triggerRef.current?.focus();
  }, []);

  // Ouverture : focus dans le tiroir + piège de tabulation + fermeture sur Échap.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-drawer-close]")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeDrawer]);

  // Bloque le défilement de la page derrière le tiroir.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (HIDDEN_ROUTES.test(pathname)) return null;
  // Rien à afficher tant qu'aucun match n'est en direct (hors tiroir ouvert,
  // qui montre alors son état vide).
  if (!open && matches.length === 0) return null;

  return (
    <>
      {/* Bouton flottant : au-dessus de la barre de navigation, à droite. */}
      {matches.length > 0 ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={openDrawer}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls="live-drawer"
          aria-label={open ? "Fermer les matchs en direct" : "Ouvrir les matchs en direct"}
          className="fixed bottom-[calc(var(--mobile-nav-height)+0.75rem)] right-3 z-30 inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-3.5 py-2 shadow-lg backdrop-blur md:hidden"
        >
          <LiveBadge />
          <span className="text-xs font-bold tabular-nums text-foreground">{matches.length}</span>
          <ChevronUp
            aria-hidden="true"
            className={`h-4 w-4 text-foreground transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}

      {/* Arrière-plan : assombrit la page et ferme le tiroir au clic. */}
      <div
        aria-hidden="true"
        onClick={closeDrawer}
        className={`fixed inset-0 z-40 bg-overlay transition-opacity duration-300 motion-reduce:transition-none md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Tiroir : coulisse depuis le bas (translate-y). */}
      <div
        id="live-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Matchs en direct"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-t-[21px] border-t-2 border-t-accent bg-background shadow-2xl transition-transform duration-300 motion-reduce:transition-none md:hidden ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground">
            <LiveBadge />
            <span>
              {matches.length} match{matches.length > 1 ? "s" : ""} en direct
            </span>
          </p>
          <div className="flex items-center gap-2">
            {refreshing ? (
              <span role="status" className="text-xs text-muted-foreground">
                Actualisation…
              </span>
            ) : null}
            <button
              type="button"
              data-drawer-close
              onClick={closeDrawer}
              aria-label="Fermer les matchs en direct"
              className="inline-flex items-center justify-center !rounded-full border border-border p-2 text-foreground transition-colors hover:bg-muted"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {/* Le contenu n'est monté qu'après la première ouverture : les pages
              n'embarquent pas les cartes tant que le tiroir n'a jamais été
              ouvert, et les minuteurs LiveMinute ne tournent pas pour une liste
              invisible. */}
          {!open && !everOpened ? null : matches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Aucun match en direct pour le moment.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {matches.map((match) => (
                <li key={match.id}>
                  <MatchCard match={match} compact />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Link
            href="/scores"
            className="text-sm font-bold text-editorial-link hover:underline"
          >
            Voir tous les scores →
          </Link>
        </div>
      </div>
    </>
  );
}
