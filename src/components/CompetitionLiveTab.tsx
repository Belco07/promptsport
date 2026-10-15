import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { LiveMatchCard } from "@/components/LiveMatchCard";

/** Shared within a server render: the badge and panel use the same snapshot. */
export const getCompetitionLiveMatches = cache((slug: string) => prisma.match.findMany({
  where: { competition: { slug }, status: "LIVE" },
  include: { homeTeam: true, awayTeam: true },
  orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
}));

export async function CompetitionLiveTab({ slug }: { slug: string }) {
  const matches = await getCompetitionLiveMatches(slug);
  if (!matches.length) return <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">Aucun match en direct pour le moment</p>;
  return <div className="grid gap-4 lg:grid-cols-2">
    {matches.map(match => <LiveMatchCard key={match.id} match={match} />)}
  </div>;
}
