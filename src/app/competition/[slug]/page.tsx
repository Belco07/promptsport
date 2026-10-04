import type { Metadata } from "next";
import { ArrowLeft, Trophy } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Footer } from "@/components/Footer";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { StandingsTable } from "@/components/StandingsTable";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";
import { formatMatchDate } from "@/lib/formatDate";
import { buildPageMetadata, jsonLdString, sportsOrganizationJsonLd } from "@/lib/seo";
import { computeStandings } from "@/lib/standings";

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

async function getCompetition(slug: string) {
  return prisma.competition.findUnique({
    where: { slug },
    include: {
      matches: {
        where: { status: "FINISHED" },
        orderBy: { scheduledAt: "desc" },
        include: {
          homeTeam: { select: { id: true, name: true } },
          awayTeam: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const competition = await prisma.competition.findUnique({ where: { slug } });
  if (!competition) {
    return { title: "Compétition introuvable" };
  }
  return buildPageMetadata({
    title: competition.name,
    description: `Classement et derniers résultats de ${competition.name}${
      competition.country ? ` (${competition.country})` : ""
    }.`,
    path: `/competition/${competition.slug}`,
  });
}

export default async function CompetitionPage({ params }: Props) {
  const { slug } = await params;
  const competition = await getCompetition(slug);

  if (!competition) {
    notFound();
  }

  const standings = computeStandings(competition.matches);
  const lastResults = competition.matches.slice(0, 5);

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-5xl px-4 py-10">
        {/* Données structurées : la compétition (WP8a). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              sportsOrganizationJsonLd({
                name: competition.name,
                path: `/competition/${competition.slug}`,
                sport: competition.sport ?? null,
                country: competition.country ?? null,
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

        <header className="mb-8 border-b border-neutral-200 pb-6">
          <div className="flex flex-wrap items-center gap-2">
            {competition.sport ? (
              <Badge variant="category" tone="accent">
                {competition.sport}
              </Badge>
            ) : null}
            {competition.season ? (
              <Badge variant="status" tone="neutral">
                Saison {competition.season}
              </Badge>
            ) : null}
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
            {competition.name}
          </h1>
          {competition.country ? (
            <p className="mt-1 text-sm text-neutral-500">{competition.country}</p>
          ) : null}
        </header>

        {/* Bandeau publicitaire réservé (voir AdSlot / AdSlotGate). */}
        <AdSlotGate>
          <AdSlot className="mb-8" />
        </AdSlotGate>

        <section aria-labelledby="classement">
          <h2
            id="classement"
            className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight text-primary-900"
          >
            <Trophy aria-hidden="true" className="h-5 w-5 text-accent-500" />
            Classement
          </h2>
          {/* Le tableau défile horizontalement sur mobile (colonne par colonne). */}
          <StandingsTable rows={standings} />
          <p className="article-caption mt-2">
            J : joués · G : gagnés · N : nuls · P : perdus · BP/BC : buts pour / contre · Diff :
            différence · Pts : points.
          </p>
        </section>

        <section aria-labelledby="derniers-resultats" className="mt-12">
          <h2
            id="derniers-resultats"
            className="mb-4 text-xl font-bold tracking-tight text-primary-900"
          >
            Derniers résultats
          </h2>
          {lastResults.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
              Aucun match terminé.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {lastResults.map((m) => (
                <li key={m.id}>
                  <Card interactive>
                    <Link href={`/match/${m.id}`} className="block rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-900">
                          {m.homeTeam.name}
                        </span>
                        <span className="shrink-0 text-base font-extrabold tabular-nums text-primary-900">
                          {m.homeScore != null && m.awayScore != null
                            ? `${m.homeScore} - ${m.awayScore}`
                            : "—"}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-right text-sm font-semibold text-neutral-900">
                          {m.awayTeam.name}
                        </span>
                      </div>
                      <p className="mt-1 text-center text-xs text-neutral-500">
                        {formatMatchDate(m.scheduledAt)}
                      </p>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
