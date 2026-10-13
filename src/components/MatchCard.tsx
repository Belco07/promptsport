import { LiveBadge } from "@/components/LiveBadge";
import { Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { formatMatchDate } from "@/lib/formatDate";

export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED" | "POSTPONED" | "CANCELLED";

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  SCHEDULED: "À venir",
  LIVE: "En direct",
  FINISHED: "Terminé",
  POSTPONED: "Reporté",
  CANCELLED: "Annulé",
};

/** Teinte du badge de statut, partagée avec la fiche match. */
export const MATCH_STATUS_TONES: Record<MatchStatus, BadgeTone> = {
  SCHEDULED: "neutral",
  LIVE: "live",
  FINISHED: "success",
  POSTPONED: "accent",
  CANCELLED: "neutral",
};

export type MatchCardData = {
  id: string;
  homeTeam: { name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { name: string; shortName: string | null; logoUrl: string | null };
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  scheduledAt: Date;
  /** Compétition, affichée en en-tête de carte quand elle est connue. */
  competition?: { name: string } | null;
};

/**
 * Taille d'affichage des logos d'équipes dans une carte de match.
 *
 * Volontairement maintenue à 40 px (dimension du WP8c) : au-delà, le
 * navigateur réclame la variante 64 px de l'optimiseur, et quarante logos par
 * page font grimper le poids de /scores de plus de 20 Ko. La fiche match, elle,
 * affiche bien des logos agrandis (80 px).
 */
const LOGO_SIZE = 40;

function TeamLogo({
  name,
  logoUrl,
  priority,
}: {
  name: string;
  logoUrl: string | null;
  priority?: boolean;
}) {
  if (logoUrl) {
    // Dimensions explicites (40x40) : l'espace est réservé avant le chargement,
    // donc aucun décalage de mise en page (CLS).
    return (
      <Image
        src={logoUrl}
        alt=""
        width={LOGO_SIZE}
        height={LOGO_SIZE}
        sizes={`${LOGO_SIZE}px`}
        priority={priority}
        fetchPriority={priority ? "high" : "auto"}
        className="h-10 w-10 shrink-0 rounded-full object-contain"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200 [.public-site_&]:bg-muted text-sm font-bold text-neutral-500 [.public-site_&]:text-muted-foreground"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * Carte de match pour la page /scores.
 *
 * `priority` est réservé aux premiers matchs affichés (candidats LCP de la
 * page) ; les suivants restent en lazy loading par défaut.
 */
export function MatchCard({
  match,
  priority = false,
  compact = false,
}: {
  match: MatchCardData;
  compact?: boolean;
  priority?: boolean;
}) {
  const isLive = match.status === "LIVE";
  const hasScore = match.homeScore != null && match.awayScore != null;
  const showScore = isLive || match.status === "FINISHED";
  const scoreLabel = showScore ? (hasScore ? `${match.homeScore} - ${match.awayScore}` : "–") : "vs";

  if (compact) return <article className="border border-border bg-card"><Link href={`/match/${match.id}`} className="block p-4"><div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{match.competition?.name}</span>{isLive ? <LiveBadge/> : <Badge variant="status" tone={MATCH_STATUS_TONES[match.status]}>{MATCH_STATUS_LABELS[match.status]}</Badge>}</div><div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2">{[match.homeTeam,match.awayTeam].map((team,index)=><div key={index} className="contents"><div className="flex min-w-0 items-center gap-3"><TeamLogo name={team.name} logoUrl={team.logoUrl}/><span className="truncate text-sm font-bold text-foreground">{team.shortName??team.name}</span></div><span className="text-2xl font-black tabular-nums text-foreground">{showScore?(index===0?match.homeScore:match.awayScore)??"–":"–"}</span></div>)}</div><time dateTime={match.scheduledAt.toISOString()} className="mt-3 block border-t border-border pt-3 text-xs text-muted-foreground">{formatMatchDate(match.scheduledAt)}</time></Link></article>;
  return (
    <Card as="article" interactive>
      <Link href={`/match/${match.id}`} className="block rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500 [.public-site_&]:text-muted-foreground">
            {match.competition?.name ?? "Match"}
          </span>
          {isLive ? <LiveBadge/> : <Badge variant="status" tone={MATCH_STATUS_TONES[match.status]}>{MATCH_STATUS_LABELS[match.status]}</Badge>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:flex-row sm:gap-3">
            <TeamLogo
              name={match.homeTeam.name}
              logoUrl={match.homeTeam.logoUrl}
              priority={priority}
            />
            <span className="w-full truncate text-center text-sm font-semibold text-neutral-900 [.public-site_&]:text-foreground sm:w-auto sm:text-left">
              {match.homeTeam.shortName ?? match.homeTeam.name}
            </span>
          </div>

          <span
            className={`shrink-0 px-2 text-2xl font-extrabold tabular-nums ${
              isLive ? "text-danger-600 [.public-site_&]:text-status-danger" : "text-primary-900 [.public-site_&]:text-foreground"
            }`}
          >
            {scoreLabel}
          </span>

          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:flex-row-reverse sm:gap-3">
            <TeamLogo
              name={match.awayTeam.name}
              logoUrl={match.awayTeam.logoUrl}
              priority={priority}
            />
            <span className="w-full truncate text-center text-sm font-semibold text-neutral-900 [.public-site_&]:text-foreground sm:w-auto sm:text-right">
              {match.awayTeam.shortName ?? match.awayTeam.name}
            </span>
          </div>
        </div>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-500 [.public-site_&]:text-muted-foreground">
          <Clock aria-hidden="true" className="h-3.5 w-3.5" />
          <time dateTime={match.scheduledAt.toISOString()}>{formatMatchDate(match.scheduledAt)}</time>
        </p>
      </Link>
    </Card>
  );
}
