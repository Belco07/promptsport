import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { auth } from "@/lib/auth";
import { getMatchVoteData, getTeamForms } from "@/lib/club-digest";
import { ManOfTheMatchVote } from "@/components/club/ManOfTheMatchVote";
import { ManOfTheMatchResults } from "@/components/club/ManOfTheMatchResults";
import { cache } from "react";
import { LiveScoreRefresher } from "@/components/LiveScoreRefresher";
import { LiveBadge } from "@/components/LiveBadge";
import { notFound } from "next/navigation";
import { MatchHeader } from "@/components/MatchHeader";
import { MatchTabs, matchTabs } from "@/components/MatchTabs";
import { MatchThread } from "@/components/MatchThread";
import type { Prisma, MatchCommentPhase } from "@/generated/prisma/client";
import { MatchTimeline } from "@/components/MatchTimeline";
import { MatchStats } from "@/components/MatchStats";
import { MatchLineup } from "@/components/MatchLineup";
import { ArticleCard } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { prisma } from "@/lib/prisma";
import { formatMatchDate } from "@/lib/formatDate";
import { getLastSportsUpdate } from "@/lib/live-sync";
import { withLocalFootballLive } from "@/lib/fotmob-live";
import { withStoredMatchClocks } from "@/lib/allsports-sync";
import { playerProfileKey } from "@/lib/slug";
import { buildPageMetadata, jsonLdString, sportsEventJsonLd } from "@/lib/seo";
export const dynamic="force-dynamic";
type Props={params:Promise<{id:string}>;searchParams:Promise<{tab?:string; phase?:string}>};
const activeTab = (tab?: string): keyof typeof matchTabs => tab === "commentaires" ? "discussion" : tab === "compositions" || tab === "statistiques" || tab === "discussion" ? tab : "resume";
const getMatch = cache(async (id: string, tab: keyof typeof matchTabs) => {
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: { select: { name: true, slug: true, shortName: true, logoUrl: true, players: { select: { name: true, slug: true, teamId: true } } } },
      awayTeam: { select: { name: true, slug: true, shortName: true, logoUrl: true, players: { select: { name: true, slug: true, teamId: true } } } },
      competition: { select: { name: true, slug: true } },
      events: { orderBy: [{ minute: "asc" }, { extraMinute: "asc" }, { createdAt: "asc" }] },
      liveUpdates: {
        orderBy: [{ isPinned: "desc" }, { minute: "asc" }, { createdAt: "asc" }],
        include: { author: { select: { name: true } } },
      },
      statistics: tab === "statistiques",
      lineups: tab === "compositions",
      articles: { where: { status: "PUBLISHED", publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: 5,
        select: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, isPremium: true, author: { select: { name: true, slug: true } }, category: { select: { name: true } } } },
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
 const session = match.status === "FINISHED" || active === "discussion" ? await auth() : null;
 const currentPhase: MatchCommentPhase = match.status === "LIVE" ? "LIVE" : match.status === "FINISHED" ? "POST_MATCH" : "PRE_MATCH";
 const phase: MatchCommentPhase = query.phase === "LIVE" || query.phase === "PRE_MATCH" || query.phase === "POST_MATCH" ? query.phase : currentPhase;
 const userId = session?.user?.id ?? null;
 const visible: Prisma.MatchCommentWhereInput = { matchId: id, OR: [{ status: "APPROVED" }, ...(userId ? [{ status: "PENDING" as const, OR: [{ readerId: userId }, { authorId: userId }] }] : [])] };
 const thread = active === "discussion" ? await Promise.all([
   prisma.matchComment.findMany({ where: { ...visible, phase }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { reader: { select: { name: true } }, author: { select: { name: true } }, parent: { select: { status: true, reader: { select: { name: true } }, author: { select: { name: true } } } } } }),
   prisma.matchComment.groupBy({ by: ["phase"], where: visible, _count: { _all: true } }),
   userId ? prisma.author.findUnique({ where: { id: userId }, select: { bannedUntil: true } }) : Promise.resolve(null),
 ]) : null;
 const vote = match.status === "FINISHED" ? await getMatchVoteData(id, session?.user?.id ?? null) : null;
 const teamForms = match.status === "SCHEDULED" ? Object.fromEntries((await getTeamForms([match.homeTeamId, match.awayTeamId])).map(team => [team.teamId, team.form])) : {};
 const hasScore=match.homeScore!=null&&match.awayScore!=null;
 const playerLinks=Object.fromEntries([...match.homeTeam.players,...match.awayTeam.players].map(player=>[playerProfileKey(player.teamId,player.name),`/joueur/${player.slug}`]));
 return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 pb-8 md:px-6">
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


 <div className="page-band">
 <Breadcrumbs items={[{ label: "Scores", href: "/scores" }, { label: match.competition.name, href: `/competition/${match.competition.slug}` }, { label: `${match.homeTeam.name} — ${match.awayTeam.name}`, href: `/match/${match.id}` }]} />
 {match.status==="LIVE"&&<><div className="mb-3"><LiveBadge/></div>{active !== "discussion" && <LiveScoreRefresher hasLiveMatches={true} lastSync={lastUpdate?.finishedAt?.toISOString() ?? null}/>}</>}
 <MatchHeader match={match} playerLinks={playerLinks} teamForms={teamForms}/>
 </div>
 <MatchTabs id={id} active={active}/>
 <section aria-labelledby="match-panel" className="min-h-40"><h2 id="match-panel" className="mb-5 section-title">{matchTabs[active]}</h2>
 {active === "discussion" && thread ? <MatchThread matchId={id} live={match.status === "LIVE"} phase={phase} currentPhase={currentPhase} userId={userId} banned={!!thread[2]?.bannedUntil && thread[2].bannedUntil > new Date()} counts={Object.fromEntries(thread[1].map(row => [row.phase, row._count._all]))} comments={thread[0].map(row => ({ id: row.id, content: row.content, status: row.status, createdAt: row.createdAt.toISOString(), name: row.reader?.name ?? row.author?.name ?? "Compte supprimé", ownerId: row.readerId ?? row.authorId, parentId: row.parentId, parentName: row.parent?.status === "APPROVED" ? row.parent.reader?.name ?? row.parent.author?.name ?? "Compte supprimé" : null }))} /> : active==="resume"?<MatchTimeline playerLinks={playerLinks} events={match.events} updates={match.liveUpdates} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/>:active==="statistiques"?<MatchStats statistics={match.statistics} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/>:<MatchLineup lineups={match.lineups} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/>}
 </section>{vote?.status === "FINISHED" && <section aria-label="Vote homme du match" className="mt-8 rounded-xl border border-border bg-card p-5"><h2 className="text-xl font-bold text-foreground">Homme du match</h2><ManOfTheMatchVote matchId={id} candidates={vote.candidates} choice={vote.choice} signedIn={!!session?.user?.id}/><ManOfTheMatchResults results={vote.results}/></section>}<section aria-labelledby="linked-articles-title" className="mt-12 border-t-2 border-border pt-6"><h2 id="linked-articles-title" className="mb-6 section-title">Articles liés au match</h2>{match.articles.length ? <div className="grid gap-5 md:grid-cols-3">{match.articles.map(article => <ArticleCard key={article.slug} article={article} headingLevel={3} />)}</div> : <p className="text-sm text-muted-foreground">Aucun article lié pour le moment.</p>}</section><AdSlotGate><AdSlot className="mt-10"/></AdSlotGate>
 </main><Footer/></>;
}
