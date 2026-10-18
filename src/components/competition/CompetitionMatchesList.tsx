import Image from "next/image";

export type CompetitionMatchItem = {
  id: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  scheduledAt: Date;
  homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
};

/** Onglet "Actu" : liste des matchs de la compétition. */
export function CompetitionMatchesList({ matches }: { matches: CompetitionMatchItem[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {matches.map((match) => (
        <div key={match.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            {match.homeTeam.logoUrl ? (
              <Image
                src={match.homeTeam.logoUrl}
                alt=""
                width={28}
                height={28}
                className="rounded-full object-contain"
              />
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
              >
                {match.homeTeam.name.charAt(0)}
              </div>
            )}
            <div className="flex-1">
              <div className="font-semibold text-foreground">
                {match.homeTeam.shortName ?? match.homeTeam.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {match.status === "LIVE" ? "En direct" : match.status === "FINISHED" ? "Terminé" : "À venir"}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {match.status === "FINISHED"
                ? `${match.homeScore} - ${match.awayScore}`
                : match.scheduledAt.toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                  })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
