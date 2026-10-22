"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
export default function StudioMobileMenu({ children }: { children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => { if (details.current) details.current.open = false; }, [pathname]);
  return <header className="sticky top-0 z-40 border-b border-border bg-card md:hidden">
    <details ref={details} onKeyDown={event => { if (event.key === "Escape" && details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); } }}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-foreground">Menu de rédaction</summary>
      <div onClick={event => { if ((event.target as HTMLElement).closest("a,button") && details.current) details.current.open = false; }} className="absolute inset-x-0 top-full max-h-[calc(100dvh-52px)] overflow-y-auto border-b border-border bg-card p-4 shadow-xl">{children}</div>
    </details>
  </header>;
}
