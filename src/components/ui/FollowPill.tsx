"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Star } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { followTeam, unfollowTeam, followCompetition, unfollowCompetition } from "@/app/mon-sport/actions";
import { teamLogoSource } from "@/components/MatchCard";

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
  /** Couleur hexadécuelle d'accent de l'entité (ex: couleur de compétition). */
  color?: string | null;
  following?: boolean;
  signedIn?: boolean;
}

/**
 * Pastille « À suivre » réutilisable (WP34).
 *
 * Regroupe logo, nom et bouton de suivi dans une carte arrondie
 * (`rounded-full`), avec une ombre légère et la couleur d'accent au survol /
 * état actif. S'utilise dans les en-têtes club/competition, les grilles de
 * découverte, la page /mon-sport et /scores.
 *
 * Aucun appel réseau tiers : la logique de suivi repose sur les Server Actions
 * existantes (`followTeam`/`unfollowTeam`/`followCompetition`/`unfollowCompetition`).
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const isTeam = kind === "team";
  const target = href ?? (isTeam ? `/club/${slug ?? id}` : `/competition/${slug ?? id}`);
  const accent = color ? { borderColor: color } : {};

  const handleClick = async () => {
    if (!signedIn) {
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
    <Card
      className={[
        "shrink-0 flex flex-col items-center gap-2 p-3 text-center max-w-[200px] rounded-full shadow-sm border border-border bg-card transition-colors hover:shadow-md",
        color ? `hover:border-[${color}]` : "hover:border-accent/50",
      ]
        .filter(Boolean)
        .join(" ")}
      style={accent}
    >
      <CardBody className="p-0 flex flex-col items-center gap-2">
        <div className="relative shrink-0">
          {logoUrl ? (
            <Image
              src={teamLogoSource(logoUrl)}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 rounded-full object-contain border-2 border-border bg-card"
            />
          ) : (
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-3xl font-bold text-muted-foreground">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <Link
          href={target}
          className="font-bold text-foreground truncate"
          title={name}
        >
          {name}
        </Link>
        {!signedIn ? (
          <Button size="sm" variant="secondary" disabled className="w-full">
            Se connecter
          </Button>
        ) : (
          <Button
            size="sm"
            variant={following ? "primary" : "secondary"}
            disabled={pending}
            aria-pressed={following}
            onClick={handleClick}
            className="w-full rounded-full"
          >
            {pending ? "Enregistrement…" : following ? (
              <>
                <Check size={14} className="mr-1" />
                Suivi
              </>
            ) : (
              <>
                <Star size={14} className="mr-1" />
                Suivre
              </>
            )}
          </Button>
        )}
        {error && (
          <p role="alert" className="text-[10px] text-destructive">{error}</p>
        )}
      </CardBody>
    </Card>
  );
}
