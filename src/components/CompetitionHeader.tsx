"use client";

import Image from "next/image";

export interface CompetitionHeaderProps {
  competition: { id: string; name: string; slug: string; country?: string | null; logoUrl?: string | null; color?: string | null };
  action?: React.ReactNode;
  /** Couleur d'accent de la compétition (reprise sur le titre). */
  accentColor?: string | null;
}

/**
 * En-tête de page compétition (WP34) : logo géant à gauche, nom en police
 * d'affichage rehaussé de la couleur d'accent, et bouton d'action à droite.
 */
export function CompetitionHeader({
  competition,
  action,
  accentColor,
}: CompetitionHeaderProps) {
  const accent = accentColor ? { color: accentColor } : {};
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 lg:py-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-5">
          {competition.logoUrl ? (
            <Image
              src={competition.logoUrl}
              alt=""
              width={120}
              height={120}
              className="h-32 w-32 shrink-0 rounded-3xl object-contain shadow-card border border-border"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-32 w-32 shrink-0 items-center justify-center rounded-3xl bg-muted text-6xl font-black text-muted-foreground border border-border"
            >
              {competition.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-display text-4xl font-black tracking-tight text-foreground md:text-5xl lg:text-6xl" style={accent}>
              {competition.name}
            </h1>
            {competition.country && <p className="text-sm text-muted-foreground mt-1">{competition.country}</p>}
          </div>
        </div>
        <div className="shrink-0">
          {action}
        </div>
      </div>
    </div>
  );
}
