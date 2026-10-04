import type { Metadata } from "next";
import { ArrowLeft, CalendarDays, MapPin, Trophy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  MATCH_STATUS_LABELS,
  MATCH_STATUS_TONES,
  type MatchStatus,
} from "@/components/MatchCard";
import { Footer } from "@/components/Footer";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";
import { formatMatchDate } from "@/lib/formatDate";
import { buildPageMetadata, jsonLdString, sportsEventJsonLd } from "@/lib/seo";

export const revalidate = 60;

type Props = { params: Promise<{ id: string }> };

/** Taille d'affichage des logos dans l'en-tête d'un match (agrandie au WP9). */
const LOGO_SIZE = 80;

function TeamLogo({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    // Les logos sont les images les plus visibles de la fiche : dimensions
    // réservées (80x80) et chargement prioritaire (candidats LCP).
    return (
      <Image
        src={logoUrl}
        alt=""
        width={LOGO_SIZE}
        height={LOGO_SIZE}
        sizes={`${LOGO_SIZE}px`}
        priority
        fetchPriority="high"
        className="h-20 w-20 rounded-full object-contain"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-200 text-2xl font-bold text-neutral-500"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

async function getMatch(id: string) {
  return prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
      awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
      competition: { select: { name: true, slug: true } },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatch(id);
  if (!match) {
    return { title: "Match introuvable" };
  }

  const competitionName = match.competition?.name ?? "Match";
  const score =
    match.homeScore != null && match.awayScore != null
      ? ` (${match.homeScore}-${match.awayScore})`
      : "";

  return buildPageMetadata({
    title: `${match.homeTeam.name} vs ${match.awayTeam.name} — ${competitionName}`,
    description: `${match.homeTeam.name} contre ${match.awayTeam.name}${score} : ${
      competitionName
    }, le ${formatMatchDate(match.scheduledAt)}${match.venue ? ` à ${match.venue}` : ""}.`,
    path: `/match/${match.id}`,
  });
}

export default async function MatchPage({ params }: Props) {
  const { id } = await params;
  const match = await getMatch(id);

  if (!match) {
    notFound();
  }

  const isLive = match.status === "LIVE";
  const hasScore = match.homeScore != null && match.awayScore != null;
  const status = match.status as MatchStatus;

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-10">
        {/* Données structurées : la rencontre (WP8a). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              sportsEventJsonLd({
                name: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
                path: `/match/${match.id}`,
                startDate: match.scheduledAt.toISOString(),
                venue: match.venue ?? null,
                homeTeam: match.homeTeam.name,
                awayTeam: match.awayTeam.name,
                competitionName: match.competition?.name ?? null,
                description: hasScore
                  ? `${match.homeTeam.name} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.name}`
                  : `${match.homeTeam.name} contre ${match.awayTeam.name}`,
              }),
            ),
          }}
        />

        <Link
          href="/scores"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 transition-colors hover:text-primary-900"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Retour aux scores
        </Link>

        <header className="mb-6 flex flex-col items-center gap-3 text-center">
          {match.competition ? (
            <Link href={`/competition/${match.competition.slug}`}>
              <Badge variant="category" tone="primary">
                {match.competition.name}
              </Badge>
            </Link>
          ) : null}
          <Badge variant="status" tone={MATCH_STATUS_TONES[status]} pulse={isLive} className="text-sm">
            {MATCH_STATUS_LABELS[status]}
          </Badge>
        </header>

        {/* Affiche du match : logos agrandis, score mis en avant. */}
        <Card>
          <CardBody className="p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3 sm:gap-6">
              <div className="flex flex-1 flex-col items-center gap-3">
                <TeamLogo name={match.homeTeam.name} logoUrl={match.homeTeam.logoUrl} />
                <span className="text-center text-base font-bold text-neutral-900 sm:text-lg">
                  {match.homeTeam.name}
                </span>
              </div>

              <div className="flex flex-col items-center">
                <span
                  className={`text-4xl font-extrabold tabular-nums sm:text-5xl ${
                    isLive ? "text-danger-600" : "text-primary-900"
                  }`}
                >
                  {hasScore ? `${match.homeScore} - ${match.awayScore}` : "vs"}
                </span>
              </div>

              <div className="flex flex-1 flex-col items-center gap-3">
                <TeamLogo name={match.awayTeam.name} logoUrl={match.awayTeam.logoUrl} />
                <span className="text-center text-base font-bold text-neutral-900 sm:text-lg">
                  {match.awayTeam.name}
                </span>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Informations pratiques de la rencontre. */}
        <section aria-labelledby="infos-match" className="mt-8">
          <h2 id="infos-match" className="mb-3 text-lg font-bold tracking-tight text-primary-900">
            Informations du match
          </h2>
          <dl className="grid gap-3 rounded-xl border border-neutral-200 bg-white p-5 text-sm sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <CalendarDays aria-hidden="true" className="mt-0.5 h-4 w-4 text-neutral-400" />
              <div>
                <dt className="font-semibold text-neutral-700">Coup d&apos;envoi</dt>
                <dd className="text-neutral-600">
                  <time dateTime={match.scheduledAt.toISOString()}>
                    {formatMatchDate(match.scheduledAt)}
                  </time>
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Trophy aria-hidden="true" className="mt-0.5 h-4 w-4 text-neutral-400" />
              <div>
                <dt className="font-semibold text-neutral-700">Compétition</dt>
                <dd className="text-neutral-600">{match.competition?.name ?? "—"}</dd>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 text-neutral-400" />
              <div>
                <dt className="font-semibold text-neutral-700">Lieu</dt>
                <dd className="text-neutral-600">{match.venue ?? "Non communiqué"}</dd>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 h-4 w-4 text-neutral-400">
                ⏱
              </span>
              <div>
                <dt className="font-semibold text-neutral-700">Statut</dt>
                <dd className="text-neutral-600">{MATCH_STATUS_LABELS[status]}</dd>
              </div>
            </div>
          </dl>
        </section>

        {/* Bandeau publicitaire réservé (voir AdSlot / AdSlotGate). */}
        <AdSlotGate>
          <AdSlot className="mt-8" />
        </AdSlotGate>
      </main>

      <Footer />
    </>
  );
}
