import { ArrowRightLeft, CircleDot, CircleX, Pen } from "lucide-react";
import type { MatchEvent, MatchLiveUpdate } from "@/generated/prisma/client";
import Link from "next/link";
import { playerProfileKey } from "@/lib/slug";

const eventLabels = {
  GOAL: "But",
  MISSED_PENALTY: "Penalty manqué",
  YELLOW_CARD: "Carton jaune",
  RED_CARD: "Carton rouge",
  SUBSTITUTION: "Remplacement",
};

const updateLabels = {
  TEXT: "Éditorial",
  GOAL: "But",
  CARD: "Carton",
  SUB: "Remplacement",
  KEY_MOMENT: "Moment clé",
};

/** Une entrée de la timeline unifiée : événement auto ou intervention éditoriale. */
type TimelineItem =
  | { kind: "event"; minute: number; isPinned: boolean; createdAt: Date; event: MatchEvent }
  | {
      kind: "update";
      minute: number | null;
      isPinned: boolean;
      createdAt: Date;
      update: MatchLiveUpdate & { author: { name: string | null } };
    };

type RawUpdate = MatchLiveUpdate & { author: { name: string | null } };

function itemMinute(item: TimelineItem): number {
  return item.minute ?? Infinity;
}

/**
 * Fusionne les événements automatiques du match et les interventions
 * éditoriales des journalistes, triées par minute (ou par date de création
 * quand la minute est nulle). Les interventions épinglées passent en tête.
 */
function buildItems(
  events: MatchEvent[],
  updates: RawUpdate[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...events.map((event) => ({
      kind: "event" as const,
      minute: event.minute,
      isPinned: false,
      createdAt: event.createdAt,
      event,
    })),
    ...updates.map((update) => ({
      kind: "update" as const,
      minute: update.minute,
      isPinned: update.isPinned,
      createdAt: update.createdAt,
      update,
    })),
  ];
  return items.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    const minuteA = itemMinute(a), minuteB = itemMinute(b);
    if (minuteA !== minuteB) return minuteA - minuteB;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

const playerName = (
  teamId: string,
  name: string,
  playerLinks: Record<string, string>,
) => {
  const href = playerLinks[playerProfileKey(teamId, name)];
  return href ? (
    <Link href={href} className="font-semibold hover:underline focus-visible:outline-2">
      {name}
    </Link>
  ) : (
    name
  );
};

const eventText = (
  event: MatchEvent,
  team: string,
  playerLinks: Record<string, string>,
) => {
  const name = playerName(event.teamId, event.playerName, playerLinks);
  const assist = event.assistName
    ? playerName(event.teamId, event.assistName, playerLinks)
    : null;
  return event.type === "GOAL" ? (
    <>But de {name} pour {team}.{assist && <> Passe décisive de {assist}.</>}</>
  ) : event.type === "SUBSTITUTION" ? (
    <>
      {team} : {name} entre en jeu{assist && <> à la place de {assist}</>}.
    </>
  ) : (
    <>
      {eventLabels[event.type as keyof typeof eventLabels]} pour {name} ({team}).
    </>
  );
};

export function MatchTimeline({
  events,
  updates = [],
  homeTeamId,
  homeName,
  awayName,
  commentary = false,
  playerLinks = {},
}: {
  events: MatchEvent[];
  updates?: RawUpdate[];
  homeTeamId: string;
  homeName: string;
  awayName: string;
  commentary?: boolean;
  playerLinks?: Record<string, string>;
}) {
  const items = buildItems(events, updates);
  if (!items.length) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">
        Disponible prochainement — aucun événement à afficher.
      </p>
    );
  }

  const time = (item: TimelineItem) =>
    item.minute != null
      ? `${item.minute}${item.kind === "event" && item.event.extraMinute
        ? `+${item.event.extraMinute}`
        : ""
      }′`
      : "—";

  if (commentary) {
    return (
      <div>
        <p className="mb-5 text-sm text-muted-foreground">
          Fil de la rencontre : événements automatiques et interventions de la
          rédaction, les plus récents en premier.
        </p>
        <ol className="divide-y divide-border rounded-xl border border-border bg-card" aria-live="polite" aria-atomic="true">
          {[...items].reverse().map((item, index) => {
            const isUpdate = item.kind === "update";
            const text = isUpdate ? (
              <>
                <span className="font-bold text-foreground">
                  {updateLabels[item.update.type as keyof typeof updateLabels]}
                  :
                </span>{" "}
                {item.update.content}
                {item.update.author.name && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    — par {item.update.author.name}
                  </span>
                )}
              </>
            ) : (
              eventText(
                item.event,
                item.event.teamId === homeTeamId ? homeName : awayName,
                playerLinks,
              )
            );
            return (
              <li
                key={item.kind === "event" ? item.event.id : item.update.id}
                className={`animate-slide-in-right stagger-${Math.min(index + 1, 8)} flex gap-4 p-5`}
              >
                <span className="w-14 shrink-0 font-bold tabular-nums text-editorial-link">
                  {time(item)}
                </span>
                <p className="text-sm leading-relaxed text-foreground">{text}</p>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <ol className="ml-7 border-l-2 border-border" aria-live="polite" aria-atomic="true">
      {items.map((item, index) => {
        const isUpdate = item.kind === "update";
        const team = isUpdate ? null : item.event.teamId;
        return (
          <li
            key={isUpdate ? item.update.id : item.event.id}
            className={`animate-slide-in-right stagger-${Math.min(index + 1, 8)} relative flex gap-4 py-5 pl-7`}
          >
            <span
              aria-hidden="true"
              className={`absolute -left-[15px] top-5 flex h-7 w-7 items-center justify-center rounded-full border ${
                isUpdate ? "border-2 border-accent bg-background" : "border-border bg-card"
              }`}
            >
              {isUpdate ? (
                <Pen size={15} />
              ) : item.event.type === "GOAL" ? (
                <CircleDot size={17} />
              ) : item.event.type === "MISSED_PENALTY" ? (
                <CircleX size={17} className="text-status-danger" />
              ) : item.event.type === "SUBSTITUTION" ? (
                <ArrowRightLeft size={17} />
              ) : (
                <span className={`h-4 w-3 rounded-sm ${item.event.type === "RED_CARD" ? "bg-red-600" : "bg-yellow-400"}`} />
              )}
            </span>
            <span className="w-14 shrink-0 font-bold tabular-nums text-foreground">
              {time(item)}
            </span>
            <div className={`flex flex-col ${isUpdate ? "border-l-2 border-accent bg-card pl-3 py-2 rounded-lg" : "flex-col"}`}>
              {isUpdate ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wide text-accent">
                      {updateLabels[item.update.type as keyof typeof updateLabels]}
                    </span>
                    {item.update.isPinned && (
                      <span className="text-xs font-bold rounded bg-accent px-2 py-0.5 text-neutral-900">
                        Épinglé
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      Par {item.update.author.name ?? "auteur inconnu"}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground break-words">
                    {item.update.content}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-foreground">
                    {eventLabels[item.event.type as keyof typeof eventLabels]} ·{" "}
                    {playerName(
                      team!,
                      item.event.playerName,
                      playerLinks,
                    )}
                  </p>
                  {item.event.assistName && (
                    <p className="text-sm text-muted-foreground">
                      {item.event.type === "SUBSTITUTION" ? "Sortant" : "Passeur"}
                      : {playerName(team!, item.event.assistName, playerLinks)}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {team === homeTeamId ? homeName : awayName}
                  </p>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
