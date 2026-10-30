"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export type JourneyStep = { href: string; label: string };
const storageKey = "promptsport:reader-journey:v1";
const maxAge = 8 * 60 * 60 * 1000;
const JourneyContext = createContext<{ steps: JourneyStep[]; labelCurrent: (path: string, label: string) => void }>({ steps: [], labelCurrent: () => {} });
const publicPath = /^\/(?:$|mon-sport\/?$|scores\/?$|live\/?$|archives\/?$|themes\/?$|recherche\/?$|newsletter\/?$|abonnement\/?$|mentions-legales\/?$|confidentialite\/?$|(?:article|match|competition|club|joueur|auteur|theme)\/[^/]+\/?$)/;
const queryKeys = new Set(["date", "sport", "competition", "view", "tab", "phase", "page", "rubrique", "format", "category", "theme", "year", "month", "q"]);

function safeHref(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  const url = new URL(value, "https://journey.invalid");
  if (url.origin !== "https://journey.invalid" || !publicPath.test(url.pathname)) return null;
  const params = new URLSearchParams();
  url.searchParams.forEach((value, key) => { if (queryKeys.has(key) && value.length <= 200) params.append(key, value); });
  params.sort();
  return url.pathname + (params.size ? `?${params}` : "");
}

/** Pure navigation reducer: revisiting an earlier step returns to that level. */
export function advanceJourney(steps: JourneyStep[], next: JourneyStep): JourneyStep[] {
  const href = safeHref(next.href);
  if (!href) return steps;
  const step = { href, label: next.label.trim().slice(0, 250) || "Page" };
  // Entering a home hub starts a fresh journey from the reader's chosen entry.
  if (href.split("?")[0] === "/" || href.split("?")[0] === "/mon-sport") return [step];
  // Tabs, dates and filters update the existing page rather than adding clones.
  const index = steps.findIndex(item => item.href.split("?")[0] === href.split("?")[0]);
  const updated = index < 0 ? [...steps, step] : [...steps.slice(0, index), step];
  return updated.length > 8 ? [updated[0], ...updated.slice(-7)] : updated;
}

function readJourney(): JourneyStep[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (!stored || typeof stored.updatedAt !== "number" || Date.now() - stored.updatedAt > maxAge || !Array.isArray(stored.steps)) return [];
    return stored.steps.filter((item: JourneyStep) => item && typeof item.href === "string" && typeof item.label === "string" && safeHref(item.href) === item.href).slice(-8);
  } catch { return []; }
}

function JourneyTracker({ visit }: { visit: (step: JourneyStep) => void }) {
  const pathname = usePathname(), params = useSearchParams();
  useEffect(() => {
    if (!publicPath.test(pathname)) return;
    const canonical = document.querySelector<HTMLElement>('[data-breadcrumb] [aria-current="page"]');
    const label = pathname === "/" ? "Accueil" : canonical?.textContent ?? document.querySelector("main h1")?.textContent ?? document.title.replace(/\s*[|—]\s*PromptSport.*$/, "");
    visit({ href: pathname + (params.size ? `?${params}` : ""), label });
  }, [pathname, params, visit]);
  return null;
}

/** Tab-local history; private pages, tokens and payment URLs are never recorded. */
export function ReaderJourney({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<JourneyStep[]>([]);
  const currentSteps = useRef<JourneyStep[] | null>(null);
  const save = useCallback((updated: JourneyStep[]) => {
    currentSteps.current = updated;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ updatedAt: Date.now(), steps: updated })); } catch { /* Navigation also works with storage disabled. */ }
    setSteps(updated);
  }, []);
  const visit = useCallback((next: JourneyStep) => { save(advanceJourney(currentSteps.current ?? readJourney(), next)); }, [save]);
  const labelCurrent = useCallback((path: string, label: string) => {
    const current = currentSteps.current, last = current?.[current.length - 1];
    if (last?.href.split("?")[0] === path && last.label !== label) save([...current!.slice(0, -1), { ...last, label: label.slice(0, 250) }]);
  }, [save]);
  return <JourneyContext.Provider value={{ steps, labelCurrent }}><Suspense fallback={null}><JourneyTracker visit={visit} /></Suspense>{children}</JourneyContext.Provider>;
}

export function useReaderJourney() { return useContext(JourneyContext); }
