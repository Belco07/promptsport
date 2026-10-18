import Image from "next/image";
import Link from "next/link";
import { LiveBadge } from "@/components/LiveBadge";
import { LiveMinute } from "@/components/LiveMinute";
import { teamLogoSource } from "@/components/MatchCard";

type LiveTeam = { name: string; logoUrl: string | null };
type LiveMatch = {
  id: string; homeTeam: LiveTeam; awayTeam: LiveTeam;
  homeScore: number | null; awayScore: number | null;
  minute?: string | null; minuteObservedAt?: string | null; minutePeriodEnd?: number | null;
};

export function LiveMatchCard({ match }: { match: LiveMatch }) {
  return <Link href={`/match/${match.id}`} className="block rounded-lg border border-border bg-card p-4 text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-editorial-link sm:p-6">
    <div className="mb-5 flex items-center justify-center gap-3"><LiveBadge /><span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{match.minute ? <LiveMinute minute={match.minute} observedAt={match.minuteObservedAt} periodEnd={match.minutePeriodEnd} /> : "En cours"}</span></div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
      <Team team={match.homeTeam} />
      <span className="inline-flex items-center gap-2 tabular-nums sm:gap-3"><span className="text-3xl font-extrabold sm:text-4xl">{match.homeScore ?? "—"}</span><span aria-hidden="true" className="h-7 border-l border-current opacity-40" /><span className="text-3xl font-extrabold sm:text-4xl">{match.awayScore ?? "—"}</span></span>
      <Team team={match.awayTeam} />
    </div>
  </Link>;
}

function Team({ team }: { team: LiveTeam }) {
  return <span className="flex min-w-0 flex-col items-center gap-2 text-center">
    {team.logoUrl ? <Image src={teamLogoSource(team.logoUrl)} alt="" width={40} height={40} sizes="40px" className="h-10 w-10 object-contain" /> : <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-bold">{team.name.charAt(0)}</span>}
    <span className="w-full break-words text-sm font-semibold">{team.name}</span>
  </span>;
}
