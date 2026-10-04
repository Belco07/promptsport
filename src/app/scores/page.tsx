import type { Metadata } from "next";
import { Radio } from "lucide-react";

import { MatchCard, type MatchCardData } from "@/components/MatchCard";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { prisma } from "@/lib/prisma";
import { buildPageMetadata, itemListJsonLd, jsonLdString } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Scores en direct",
  description:
    "Résultats, matchs en direct et rencontres à venir : suivez les scores de toutes les compétitions.",
  path: "/scores",
});

export const revalidate = 60;

const matchSelect = {
  id: true,
  homeScore: true,
  awayScore: true,
  status: true,
  scheduledAt: true,
  homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
  awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
  competition: { select: { slug: true, name: true, sport: true } },
} as const;

function buildWhere({ sport, competition }: { sport?: string; competition?: string }) {
  if (!sport && !competition) {
    return {};
  }
  return {
    competition: {
      ...(competition ? { slug: competition } : {}),
      ...(sport ? { sport } : {}),
    },
  };
}

/** Titre de section, avec compteur et pastille pour le direct. */
function SectionHeading({
  title,
  count,
  live = false,
}: {
  title: string;
  count: number;
  live?: boolean;
}) {
  return (
    <h2 className="mb-4 flex items-center gap-2 text-xl font-bold tracking-tight text-primary-900">
      {live ? (
        <Radio aria-hidden="true" className="h-5 w-5 text-danger-600" />
      ) : null}
      {title}
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
        {count}
      </span>
    </h2>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-500">
      {label}
    </p>
  );
}

export default async function ScoresPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; competition?: string }>;
}) {
  const { sport, competition } = await searchParams;
  const filter = { sport, competition };

  const [live, upcoming, finished, sports, competitions] = await Promise.all([
    prisma.match.findMany({
      where: { status: "LIVE", ...buildWhere(filter) },
      orderBy: { scheduledAt: "asc" },
      select: matchSelect,
    }),
    prisma.match.findMany({
      where: { status: "SCHEDULED", ...buildWhere(filter) },
      orderBy: { scheduledAt: "asc" },
      take: 10,
      select: matchSelect,
    }),
    prisma.match.findMany({
      where: { status: "FINISHED", ...buildWhere(filter) },
      orderBy: { scheduledAt: "desc" },
      take: 10,
      select: matchSelect,
    }),
    prisma.competition.findMany({
      distinct: ["sport"],
      select: { sport: true },
      orderBy: { sport: "asc" },
    }),
    prisma.competition.findMany({
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const filtered = Boolean(sport || competition);

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-5xl px-4 py-10">
        {/* Données structurées : liste des matchs à venir (WP8a). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              itemListJsonLd({
                name: "Matchs à venir",
                path: "/scores",
                items: upcoming.map((match) => ({
                  name: `${match.homeTeam.name} - ${match.awayTeam.name}`,
                  url: `/match/${match.id}`,
                })),
              }),
            ),
          }}
        />

        <header className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
            Scores
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Matchs en direct, rencontres à venir et derniers résultats de toutes les
            compétitions suivies.
          </p>
        </header>

        {/* Bandeau publicitaire réservé (voir AdSlot / AdSlotGate). */}
        <AdSlotGate>
          <AdSlot className="mb-8" />
        </AdSlotGate>

        {/* Filtres : formulaire GET, sans JavaScript côté client. */}
        <Card className="mb-8">
          <CardBody>
            <form method="get" action="/scores" className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <Select
                name="sport"
                label="Sport"
                defaultValue={sport ?? ""}
                className="bg-white"
                options={sports.map((s) => ({ value: s.sport, label: s.sport }))}
                placeholder="Tous les sports"
              />
              <Select
                name="competition"
                label="Compétition"
                defaultValue={competition ?? ""}
                className="bg-white"
                options={competitions.map((c) => ({ value: c.slug, label: c.name }))}
                placeholder="Toutes les compétitions"
              />
              <div className="flex items-center gap-2">
                <Button type="submit" size="md">
                  Filtrer
                </Button>
                {filtered ? (
                  <a
                    href="/scores"
                    className="text-sm font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                  >
                    Réinitialiser
                  </a>
                ) : null}
              </div>
            </form>
          </CardBody>
        </Card>

        <section className="mb-10">
          <SectionHeading title="En direct" count={live.length} live />
          {live.length === 0 ? (
            <Empty label="Aucun match en direct pour le moment." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {live.map((m, index) => (
                <MatchCard key={m.id} match={m as unknown as MatchCardData} priority={index === 0} />
              ))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <SectionHeading title="À venir" count={upcoming.length} />
          {upcoming.length === 0 ? (
            <Empty label="Aucun match à venir." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {upcoming.map((m, index) => (
                <MatchCard
                  key={m.id}
                  match={m as unknown as MatchCardData}
                  // Si aucun match n'est en direct, la première affiche de la page
                  // est celle de cette section : c'est elle qui doit être prioritaire.
                  priority={live.length === 0 && index === 0}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mb-10">
          <SectionHeading title="Terminés récemment" count={finished.length} />
          {finished.length === 0 ? (
            <Empty label="Aucun match terminé." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {finished.map((m) => (
                <MatchCard key={m.id} match={m as unknown as MatchCardData} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
