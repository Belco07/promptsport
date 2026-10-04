import Link from "next/link";

/**
 * Bandeau de scores, tout en haut des pages publiques.
 *
 * Il montre les matchs **en direct** d'abord, puis les matchs du jour (résultats
 * et rencontres à venir) : un bandeau qui n'apparaîtrait qu'en direct resterait
 * vide l'essentiel du temps, la synchronisation sportive ne tournant que quelques
 * fois par jour.
 *
 * Composant **serveur** : aucun JavaScript n'est envoyé pour ce bandeau, il
 * n'ajoute donc rien au coût d'hydratation des pages publiques. Le défilement
 * horizontal est du CSS (`overflow-x-auto`), pas un carrousel.
 *
 * Les logos d'équipes ne sont pas affichés : le bandeau est présent sur toutes
 * les pages, au-dessus de la ligne de flottaison — des images y coûteraient des
 * requêtes sur chaque page pour une information déjà lisible en abrégé.
 */

export type ScoresStripMatch = {
  id: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Date, ou chaîne ISO : voir `toDate` ci-dessous. */
  scheduledAt: Date | string;
  competition: { name: string; slug: string } | null;
  homeTeam: { name: string; shortName: string | null };
  awayTeam: { name: string; shortName: string | null };
};

/**
 * Le bandeau est rendu par le serveur mais transmis à `PublicNav` (composant
 * client) : React sérialise alors ses propriétés et les `Date` reviennent sous
 * forme de chaînes ISO. On normalise donc avant tout usage — sans quoi
 * `scheduledAt.getTime()` échoue et la page répond 500.
 */
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
});

/** Vrai si la date tombe le jour courant du serveur. */
function isToday(value: Date): boolean {
  const now = new Date();
  return (
    value.getDate() === now.getDate() &&
    value.getMonth() === now.getMonth() &&
    value.getFullYear() === now.getFullYear()
  );
}

/**
 * Libellé court de l'état du match.
 *
 * Les rencontres hors du jour courant affichent leur date : le bandeau peut se
 * rabattre sur les derniers résultats quand la synchronisation sportive date de
 * quelques jours, et « Terminé » seul laisserait croire à un match du jour.
 */
function statusLabel(match: ScoresStripMatch): string {
  const scheduledAt = toDate(match.scheduledAt);
  switch (match.status) {
    case "LIVE":
      return "EN DIRECT";
    case "POSTPONED":
      return "Reporté";
    case "CANCELLED":
      return "Annulé";
    case "FINISHED":
      return isToday(scheduledAt) ? "Terminé" : shortDateFormatter.format(scheduledAt);
    default:
      return isToday(scheduledAt)
        ? timeFormatter.format(scheduledAt)
        : shortDateFormatter.format(scheduledAt);
  }
}

export function LiveScoresBar({ matches }: { matches: ScoresStripMatch[] }) {
  if (matches.length === 0) {
    return null;
  }

  // Le direct d'abord, puis les matchs du jour dans l'ordre chronologique ; les
  // matchs en cours peuvent dater de la veille (fin de rencontre après minuit).
  const ordered = [...matches].sort((a, b) => {
    if (a.status === "LIVE" && b.status !== "LIVE") return -1;
    if (b.status === "LIVE" && a.status !== "LIVE") return 1;
    return toDate(a.scheduledAt).getTime() - toDate(b.scheduledAt).getTime();
  });
  const liveCount = ordered.filter((match) => match.status === "LIVE").length;

  return (
    <section
      aria-label="Scores et matchs en direct"
      data-scores-strip=""
      className="border-b border-white/10 bg-ink-950 text-white"
    >
      <div className="mx-auto flex max-w-6xl items-stretch">
        <p className="flex shrink-0 items-center gap-2 border-r border-white/10 px-[14px] text-[10px] font-extrabold uppercase tracking-[1.4px] max-[600px]:hidden">
          {liveCount > 0 ? (
            <>
              <span
                aria-hidden="true"
                className="h-[7px] w-[7px] animate-pulse rounded-full bg-brand-500"
              />
              En direct
            </>
          ) : (
            "Scores"
          )}
        </p>

        <ul className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {ordered.map((match) => {
            const live = match.status === "LIVE";
            const finished = match.status === "FINISHED";
            const hasScore = match.homeScore !== null && match.awayScore !== null;

            return (
              <li key={match.id} className="shrink-0 border-r border-white/10 last:border-r-0">
                <Link
                  href={`/match/${match.id}`}
                  className="flex h-full items-center gap-[10px] px-[13px] py-[9px] text-[11px] transition-colors hover:bg-white/10"
                >
                  {match.competition ? (
                    <span className="max-w-[120px] truncate text-[9px] font-bold uppercase tracking-[.7px] text-white/50">
                      {match.competition.name}
                    </span>
                  ) : null}

                  <span className="flex items-center gap-[6px]">
                    <span className="font-semibold">
                      {match.homeTeam.shortName ?? match.homeTeam.name}
                    </span>
                    <span
                      className={`tabular-nums ${live ? "font-extrabold text-brand-400" : "font-bold"}`}
                    >
                      {hasScore ? `${match.homeScore} - ${match.awayScore}` : "—"}
                    </span>
                    <span className="font-semibold">
                      {match.awayTeam.shortName ?? match.awayTeam.name}
                    </span>
                  </span>

                  <span
                    className={`text-[9px] font-extrabold uppercase tracking-[.7px] ${
                      live ? "text-brand-400" : finished ? "text-white/60" : "text-white/45"
                    }`}
                  >
                    {statusLabel(match)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
