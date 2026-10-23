"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { EntityLogo } from "@/components/EntityLogo";
import { FollowToggle } from "@/components/FollowButton";
import { followTeam, unfollowTeam, followCompetition, unfollowCompetition } from "@/app/mon-sport/actions";

export type FollowPillKind = "team" | "competition";

export interface FollowPillProps {
  id: string;
  kind: FollowPillKind;
  name: string;
  logoUrl?: string | null;
  /** Lien de destination (ex: /club/:slug ou /competition/:slug). */
  href?: string;
  /** Slug de l'entité, utilisé pour construire le lien par défaut. */
  slug?: string;
  /** Couleur hexadécimale d'accent de l'entité (bordure au survol). */
  color?: string | null;
  following?: boolean;
  signedIn?: boolean;
}

/**
 * Pastille de club ou de compétition (WP34), version compacte :
 * logo de 40 px, nom sur une ligne, petit bouton « Suivre » / « Suivi ».
 *
 * Carte arrondie à 13 px avec ombre douce, comme les cartes d'articles.
 * Un visiteur non connecté est envoyé vers la connexion (retour sur la page).
 * Le suivi repose sur les Server Actions existantes.
 */
export function FollowPill({
  id,
  kind,
  name,
  logoUrl,
  href,
  slug,
  color,
  following = false,
  signedIn = false,
}: FollowPillProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const isTeam = kind === "team";
  const target = href ?? (isTeam ? `/club/${slug ?? id}` : `/competition/${slug ?? id}`);

  const handleClick = () => {
    if (!signedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setError("");
    startTransition(async () => {
      try {
        const action = isTeam
          ? (following ? unfollowTeam : followTeam)
          : (following ? unfollowCompetition : followCompetition);
        const result = await action(id);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Connexion interrompue.");
      }
    });
  };

  return (
    <div
      style={color ? { borderColor: color } : undefined}
      className="flex w-full min-w-0 max-w-[170px] flex-col items-center gap-1.5 rounded-[13px] border border-border bg-card px-2.5 py-3 text-center shadow-[0_4px_20px_rgb(0_0_0/7%)] transition-shadow hover:shadow-[0_6px_28px_rgb(0_0_0/12%)]"
    >
      <Link href={target} tabIndex={-1} aria-hidden="true">
        <EntityLogo kind={kind} name={name} logoUrl={logoUrl} slug={slug} size={40} />
      </Link>
      <Link href={target} title={name} className="max-w-full truncate text-[13px] font-bold text-foreground hover:text-editorial-link">
        {name}
      </Link>
      <FollowToggle name={name} following={following} pending={pending} onClick={handleClick} />
      {error && <p role="alert" className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}
