"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

/**
 * Sélecteur de thème (WP13a) : clair, sombre ou système.
 *
 * Trois précautions :
 *  - le composant n'est rendu qu'**après montage** : next-themes lit le thème
 *    dans localStorage côté client, et l'icône affichée avant montage ne
 *    correspondrait pas au thème réel (avertissement d'hydratation) ; une place
 *    de même taille est réservée entre-temps, donc aucun décalage de mise en page ;
 *  - le menu est un vrai menu ARIA (`role="menu"` / `menuitemradio`), fermable au
 *    clic extérieur et avec Échap, navigable aux flèches — la même logique que le
 *    menu Compétitions de la barre publique ;
 *  - son balisage est toujours présent (masqué par l'attribut `hidden` quand il
 *    est fermé) : les trois choix restent lisibles dans le HTML servi et sont donc
 *    contrôlables par les suites.
 */

const OPTIONS = [
  { value: "light", label: "Clair", Icon: Sun },
  { value: "dark", label: "Sombre", Icon: Moon },
  { value: "system", label: "Système", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fermeture au clic extérieur et sur Échap.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Navigation aux flèches dans le menu ouvert.
  function handleMenuKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const next = (index + offset + OPTIONS.length) % OPTIONS.length;
    itemRefs.current[next]?.focus();
  }

  // Avant montage : place réservée, aucune icône (le thème n'est pas encore connu).
  if (!mounted) {
    return <span aria-hidden="true" className="inline-block h-9 w-9" />;
  }

  const current = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[2];
  const CurrentIcon = current.Icon;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Thème : ${current.label.toLowerCase()}`}
        title="Changer de thème"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-600"
      >
        <CurrentIcon aria-hidden="true" size={17} />
      </button>

      <ul
        role="menu"
        aria-label="Choix du thème"
        hidden={!open}
        className="absolute right-0 z-40 mt-2 w-40 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 shadow-card"
      >
        {OPTIONS.map(({ value, label, Icon }, index) => (
          <li key={value} role="none">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              onClick={() => {
                setTheme(value);
                setOpen(false);
              }}
              onKeyDown={(event) => handleMenuKeyDown(event, index)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-100 ${
                theme === value ? "font-semibold text-brand-700" : "text-ink-700"
              }`}
            >
              <Icon aria-hidden="true" size={15} />
              {label}
              {theme === value ? (
                <span className="ml-auto text-[10px] uppercase tracking-[1px] text-brand-600">
                  actif
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
