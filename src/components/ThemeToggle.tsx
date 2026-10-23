"use client";
import { Moon, Sun } from "@/components/icons";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Bascule jour / nuit, comme la référence « Digital Haven » : une seule icône
 * de 20 px (soleil en mode jour, lune en mode nuit), sans pastille ; au clic,
 * l'icône courante s'efface en tournant pendant que l'autre apparaît. Une
 * infobulle annonce le mode suivant.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span aria-hidden="true" className="inline-block h-7 w-7" />;
  const dark = resolvedTheme === "dark";
  const label = dark ? "Passer en mode jour" : "Passer en mode nuit";
  const icon = "absolute inset-0 m-auto h-5 w-5 transition-all duration-300 motion-reduce:transition-none";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="relative inline-flex h-7 w-7 items-center justify-center text-foreground transition-colors hover:text-editorial-link focus-visible:outline-2"
    >
      <Sun aria-hidden="true" size={20} className={`${icon} ${dark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"}`} />
      <Moon aria-hidden="true" size={20} className={`${icon} ${dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"}`} />
    </button>
  );
}
