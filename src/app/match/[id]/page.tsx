import type { Metadata } from "next";
import { cache } from "react";
import { LiveScoreRefresher } from "@/components/LiveScoreRefresher";
import { LiveBadge } from "@/components/LiveBadge";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MatchHeader } from "@/components/MatchHeader";
import { MatchTabs, matchTabs } from "@/components/MatchTabs";
import { MatchTimeline } from "@/components/MatchTimeline";
import { MatchStats } from "@/components/MatchStats";
import { MatchLineup } from "@/components/MatchLineup";
import { RelatedArticles } from "@/components/RelatedArticles";
import { Footer } from "@/components/Footer";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { prisma } from "@/lib/prisma";
import { formatMatchDate } from "@/lib/formatDate";
import { getLastSportsUpdate } from "@/lib/live-sync";
import { withLocalFootballLive } from "@/lib/fotmob-live";
import { withStoredMatchClocks } from "@/lib/allsports-sync";
import { buildPageMetadata, jsonLdString, sportsEventJsonLd } from "@/lib/seo";
export const dynamic="force-dynamic";
type Props={params:Promise<{id:string}>;searchParams:Promise<{tab?:string}>};
const activeTab = (tab?: string): keyof typeof matchTabs => tab === "compositions" || tab === "statistiques" || tab === "commentaires" ? tab : "resume";
const getMatch = cache(async (id: string, tab: keyof typeof matchTabs) => {
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
      awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
      competition: { select: { name: true, slug: true } },
      events: { orderBy: [{ minute: "asc" }, { extraMinute: "asc" }, { createdAt: "asc" }] },
      statistics: tab === "statistiques",
      lineups: tab === "compositions",
    },
  });
  return match ? (await withLocalFootballLive(await withStoredMatchClocks([match])))[0] : null;
});

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const match = await getMatch(id, activeTab((await searchParams).tab));
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


export default async function MatchPage({params,searchParams}:Props){
 const {id}=await params;const query=await searchParams;const active=activeTab(query.tab);const match=await getMatch(id,active);if(!match)notFound();
 const lastUpdate=match.status==="LIVE"?await getLastSportsUpdate("live"):null;
 const hasScore=match.homeScore!=null&&match.awayScore!=null;
 return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 py-8 md:px-6">
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


 <Link href="/scores" className="mb-6 inline-block text-sm font-bold text-editorial-link">← Tous les scores</Link>
 {match.status==="LIVE"&&<><div className="mb-3"><LiveBadge/></div><LiveScoreRefresher hasLiveMatches={true} lastSync={lastUpdate?.finishedAt?.toISOString() ?? null}/></>}
 <MatchHeader match={match}/><MatchTabs id={id} active={active}/>
 <section aria-labelledby="match-panel" className="min-h-40"><h2 id="match-panel" className="mb-5 text-2xl font-black uppercase text-foreground">{matchTabs[active]}</h2>
 {active==="resume"||active==="commentaires"?<MatchTimeline commentary={active==="commentaires"} events={match.events} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/>:active==="statistiques"?<MatchStats statistics={match.statistics} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/>:<MatchLineup lineups={match.lineups} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/>}
 </section><RelatedArticles teams={[match.homeTeam.name,match.homeTeam.shortName??match.homeTeam.name,match.awayTeam.name,match.awayTeam.shortName??match.awayTeam.name]}/><AdSlotGate><AdSlot className="mt-10"/></AdSlotGate>
 </main><Footer/></>;
}
