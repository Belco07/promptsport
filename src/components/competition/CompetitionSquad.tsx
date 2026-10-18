import Image from "next/image";

export type CompetitionPlayerItem = {
  id: string;
  name: string;
  position: string | null;
  team: { id: string; name: string; slug: string; logoUrl: string | null };
};
export function CompetitionSquad({ players }: { players: CompetitionPlayerItem[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {players.map((player) => (
        <div key={player.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            {player.team.logoUrl ? (
              <Image
                src={player.team.logoUrl}
                alt=""
                width={28}
                height={28}
                className="rounded-full object-contain"
              />
            ) : (
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground"
              >
                {player.team.name.charAt(0)}
              </div>
            )}
            <div>
              <div className="font-semibold text-foreground">{player.name}</div>
              <div className="text-xs text-muted-foreground">
                {player.position ?? "—"}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
