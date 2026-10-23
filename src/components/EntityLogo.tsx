"use client";

import Image from "next/image";
import { useState } from "react";

import { Trophy } from "@/components/icons";
import { teamLogoSource } from "@/components/MatchCard";

/**
 * Logo d'un club ou d'une compétition, identique partout sur le site.
 *
 * Source : le `logoUrl` enregistré en base (clubs : football-data / SofaScore,
 * via `teamLogoSource` ; compétitions : API-Sports). À défaut, ou si l'image ne
 * se charge pas, une pastille de repli de même taille : initiales du club, ou
 * trophée pour une compétition. Le fond reste blanc dans les deux thèmes, pour
 * que les écussons sombres restent lisibles en mode nuit.
 */

// Repli pour les compétitions dont le logo n'est pas encore enregistré en base.
const LEAGUE_IDS: Record<string, number> = {
  "ligue-1": 61,
  "premier-league": 39,
  liga: 140,
  "serie-a": 135,
  bundesliga: 78,
  "uefa-champions-league": 2,
  "uefa-europa-league": 3,
  "uefa-conference-league": 848,
};

function initials(name: string): string {
  const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s.-]+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : name.slice(0, 2)).toUpperCase();
}

export function EntityLogo({
  kind,
  name,
  logoUrl,
  slug,
  size = 32,
  className = "",
}: {
  kind: "team" | "competition";
  name: string;
  logoUrl?: string | null;
  slug?: string | null;
  size?: number;
  className?: string;
}) {
  const source = logoUrl
    ? (kind === "team" ? teamLogoSource(logoUrl) : logoUrl)
    : kind === "competition" && slug && LEAGUE_IDS[slug]
      ? `https://media.api-sports.io/football/leagues/${LEAGUE_IDS[slug]}.png`
      : null;
  const [failed, setFailed] = useState<string | null>(null);
  const inner = Math.round(size * 0.78);

  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-white ${className}`}
    >
      {source && failed !== source ? (
        <Image
          src={source}
          alt=""
          width={inner}
          height={inner}
          loading="lazy"
          style={{ width: inner, height: inner }}
          className="object-contain"
          onError={() => setFailed(source)}
        />
      ) : kind === "competition" ? (
        <Trophy size={Math.round(size * 0.5)} className="text-neutral-500" />
      ) : (
        <span className="font-black text-neutral-500" style={{ fontSize: Math.max(9, Math.round(size * 0.34)) }}>{initials(name)}</span>
      )}
    </span>
  );
}
