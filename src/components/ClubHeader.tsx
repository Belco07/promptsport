"use client";

import { EntityLogo } from "@/components/EntityLogo";
import { FollowButton } from "@/components/FollowButton";

export interface ClubHeaderProps {
  club: { id: string; name: string; slug: string; logoUrl?: string | null; color?: string | null; country?: string | null };
  competitions?: Array<{ slug: string; name: string; color?: string | null }>;
  signedIn?: boolean;
  following?: boolean;
  /** Couleur d'accent de la compétition principale (reprise sur le titre et les onglets). */
  accentColor?: string | null;
}

/**
 * En-tête de page club (WP34) : grand logo à gauche (même composant que les
 * pastilles du site), nom en police d'affichage, et petit bouton « Suivre » à
 * droite. La couleur d'accent de la compétition rehausse le titre quand elle
 * est connue.
 */
export function ClubHeader({
  club,
  signedIn = false,
  following = false,
  accentColor,
}: ClubHeaderProps) {
  const accent = accentColor ? { color: accentColor } : {};
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 md:px-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <EntityLogo kind="team" name={club.name} logoUrl={club.logoUrl} slug={club.slug} size={96} className="shadow-card" />
          <div>
            <h1 className="font-display text-3xl font-black tracking-tight text-foreground md:text-4xl" style={accent}>
              {club.name}
            </h1>
            {club.country && <p className="text-sm text-muted-foreground">{club.country}</p>}
          </div>
        </div>
        <FollowButton id={club.id} kind="team" name={club.name} following={following} signedIn={signedIn} />
      </div>
    </div>
  );
}
