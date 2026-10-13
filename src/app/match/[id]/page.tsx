import type { Metadata } from "next";
import { LiveScoreRefresher } from "@/components/LiveScoreRefresher";
import { LiveBadge } from "@/components/LiveBadge";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MatchHeader } from "@/components/MatchHeader";
import { MatchTabs, matchTabs } from "@/components/MatchTabs";
import { EventTimeline } from "@/components/EventTimeline";
import { RelatedArticles } from "@/components/RelatedArticles";
import { Footer } from "@/components/Footer";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { prisma } from "@/lib/prisma";
import { formatMatchDate } from "@/lib/formatDate";
import { getLastSportsUpdate } from "@/lib/live-sync";
import { buildPageMetadata, jsonLdString, sportsEventJsonLd } from "@/lib/seo";
export const dynamic="force-dynamic";
type Props={params:Promise<{id:string}>;searchParams:Promise<{tab?:string}>};
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


export default async function MatchPage({params,searchParams}:Props){
 const {id}=await params;const query=await searchParams;const match=await getMatch(id);if(!match)notFound();
 const lastUpdate=match.status==="LIVE"?await getLastSportsUpdate("live"):null;
 const hasScore=match.homeScore!=null&&match.awayScore!=null;
 const active:keyof typeof matchTabs=query.tab==="compositions"||query.tab==="statistiques"||query.tab==="commentaires"?query.tab:"resume";
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
 {active==="resume"?<EventTimeline/>:<p className="border border-border bg-card p-6 text-muted-foreground">{active==="compositions"?"Les compositions seront disponibles avant le match.":active==="statistiques"?"Les statistiques détaillées seront disponibles prochainement.":"Les commentaires de ce match seront disponibles prochainement."}</p>}
 </section><RelatedArticles teams={[match.homeTeam.shortName??match.homeTeam.name,match.awayTeam.shortName??match.awayTeam.name]}/><AdSlotGate><AdSlot className="mt-10"/></AdSlotGate>
 </main><Footer/></>;
}
