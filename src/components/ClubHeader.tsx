"use client";

import Image from "next/image";

import { FollowPill } from "@/components/ui/FollowPill";

export interface ClubHeaderProps {
  club: { id: string; name: string; slug: string; logoUrl?: string | null; color?: string | null; country?: string | null };
  competitions?: Array<{ slug: string; name: string; color?: string | null }>;
  signedIn?: boolean;
  following?: boolean;
  /** Couleur d'accent de la compétition principale (reprise sur le titre et les onglets). */
  accentColor?: string | null;
}

/**
 * En-tête de page club (WP34) : logo géant à gauche, nom en police d'affichage,
 * et pilule de suivi à droite. La couleur d'accent de la compétition rehausse
 * le titre quand elle est connue.
 */
export function ClubHeader({
  club,
  competitions,
  signedIn = false,
  following = false,
  accentColor,
}: ClubHeaderProps) {
  const accent = accentColor ? { color: accentColor } : {};
  const compColor = competitions?.[0]?.color ?? accentColor ?? null;
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          {club.logoUrl ? (
            <Image
              src={club.logoUrl}
              alt=""
              width={96}
              height={96}
              className="h-24 w-24 shrink-0 rounded-2xl object-contain shadow-card border border-border"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-muted text-4xl font-bold text-muted-foreground border border-border"
            >
              {club.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-display text-3xl font-black tracking-tight text-foreground md:text-4xl" style={accent}>
              {club.name}
            </h1>
            {club.country && <p className="text-sm text-muted-foreground">{club.country}</p>}
          </div>
        </div>
        <div className="shrink-0">
          <FollowPill
            id={club.id}
            kind="team"
            name={club.name}
            logoUrl={club.logoUrl ?? null}
            slug={club.slug}
            color={compColor}
            following={following}
            signedIn={signedIn}
          />
        </div>
      </div>
    </div>
  );
}
