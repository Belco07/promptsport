import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { auth } from "@/lib/auth";
import { getMatchVoteData, getTeamForms } from "@/lib/club-digest";
import { ManOfTheMatchVote } from "@/components/club/ManOfTheMatchVote";
import { ManOfTheMatchResults } from "@/components/club/ManOfTheMatchResults";
import { cache } from "react";
import { LiveScoreRefresher } from "@/components/LiveScoreRefresher";
import Link from "next/link";
import { MatchTurningPoint } from "@/components/match/MatchTurningPoint";
import { notFound } from "next/navigation";
import { MatchHeader } from "@/components/match/MatchHeader";
import { MatchTabs, matchTabs } from "@/components/match/MatchTabs";
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
import { withStoredMatchClocks } from "@/lib/allsports-sync";
import { playerProfileKey } from "@/lib/slug";
import { buildPageMetadata, jsonLdString, sportsEventJsonLd } from "@/lib/seo";
export const dynamic="force-dynamic";
type Props={params:Promise<{id:string}>;searchParams:Promise<{tab?:string; phase?:string}>};
const activeTab = (tab?: string): keyof typeof matchTabs => tab === "commentaires" ? "discussion" : tab === "compositions" || tab === "discussion" ? tab : "resume";
const getMatch = cache(async (id: string) => {
  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      homeTeam: { select: { name: true, slug: true, shortName: true, logoUrl: true, players: { select: { name: true, slug: true, teamId: true } } } },
      awayTeam: { select: { name: true, slug: true, shortName: true, logoUrl: true, players: { select: { name: true, slug: true, teamId: true } } } },
      competition: { select: { name: true, slug: true } },
      events: { orderBy: [{ minute: "asc" }, { extraMinute: "asc" }, { createdAt: "asc" }] },
      statistics: true,
      lineups: true,
      articles: { where: { status: "PUBLISHED", publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: 5,
        select: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, isPremium: true, author: { select: { name: true, slug: true } }, category: { select: { name: true } } } },
    },
  });
  return match ? (await withStoredMatchClocks([match]))[0] : null;
});

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
 const {id}=await params;const query=await searchParams;const active=activeTab(query.tab);const match=await getMatch(id);if(!match)notFound();
 const lastUpdate=match.status==="LIVE"?await getLastSportsUpdate("live"):null;
 const session = await auth();
 const currentPhase: MatchCommentPhase = match.status === "LIVE" ? "LIVE" : match.status === "FINISHED" ? "POST_MATCH" : "PRE_MATCH";
 const phase: MatchCommentPhase = query.phase === "PRE_MATCH" || (query.phase === "LIVE" && currentPhase !== "PRE_MATCH") || (query.phase === "POST_MATCH" && currentPhase === "POST_MATCH") ? query.phase : currentPhase;
 const userId = session?.user?.id ?? null;
 const visible: Prisma.MatchCommentWhereInput = { matchId: id, OR: [{ status: "APPROVED" }, ...(userId ? [{ status: "PENDING" as const, OR: [{ readerId: userId }, { authorId: userId }] }] : [])] };
 const thread = await Promise.all([
   prisma.matchComment.findMany({ where: { ...visible, phase }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 50, include: { reader: { select: { name: true } }, author: { select: { name: true } }, parent: { select: { status: true, reader: { select: { name: true } }, author: { select: { name: true } } } } } }),
   prisma.matchComment.groupBy({ by: ["phase"], where: visible, _count: { _all: true } }),
   userId ? prisma.author.findUnique({ where: { id: userId }, select: { bannedUntil: true } }) : Promise.resolve(null),
 ]);
 const vote = match.status === "FINISHED" ? await getMatchVoteData(id, session?.user?.id ?? null) : null;
 const teamForms = match.status === "SCHEDULED" ? Object.fromEntries((await getTeamForms([match.homeTeamId, match.awayTeamId])).map(team => [team.teamId, team.form])) : {};
 const hasScore=match.homeScore!=null&&match.awayScore!=null;
 const playerLinks=Object.fromEntries([...match.homeTeam.players,...match.awayTeam.players].map(player=>[playerProfileKey(player.teamId,player.name),`/joueur/${player.slug}`]));
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


 <Breadcrumbs items={[{ label: "Scores", href: "/scores" }, { label: match.competition.name, href: `/competition/${match.competition.slug}` }, { label: `${match.homeTeam.name} — ${match.awayTeam.name}`, href: `/match/${match.id}` }]} />
 {match.status === "LIVE" && <LiveScoreRefresher hasLiveMatches={true} lastSync={lastUpdate?.finishedAt?.toISOString() ?? null}/>}
 <MatchHeader match={match} playerLinks={playerLinks} teamForms={teamForms}/>
 {match.articles[0] && <aside aria-label="À lire aussi" className="border-b border-border bg-muted/30 p-5 md:p-7"><p className="text-xs font-bold uppercase tracking-widest text-editorial-link">À lire aussi</p><Link href={'/article/' + match.articles[0].slug} className="mt-2 block text-xl font-black text-foreground hover:underline md:text-2xl">{match.articles[0].title}</Link><a href="#articles-match" className="mt-3 inline-block text-sm text-editorial-link underline">Voir tous les articles sur ce match</a></aside>}
 <MatchTabs id={id} active={active}/>
 <section id="resume" aria-labelledby="resume-title" className={'scroll-mt-24 py-8 ' + (active !== 'resume' ? 'lg:hidden' : '')}><p className="text-xs font-bold uppercase tracking-widest text-editorial-link">01 / Le fil de la rencontre</p><h2 id="resume-title" className="mb-6 mt-2 text-3xl font-black text-foreground md:text-4xl">Le Résumé</h2>
 <MatchTurningPoint events={match.events} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name} playerLinks={playerLinks}/>
 <div className="grid items-start gap-8 xl:grid-cols-2"><div><h3 className="mb-5 text-xl font-bold text-foreground">Les temps forts</h3><MatchTimeline playerLinks={playerLinks} events={match.events} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/></div><div id="statistiques"><h3 className="mb-5 text-xl font-bold text-foreground">Le match en chiffres</h3><MatchStats statistics={match.statistics} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/></div></div></section>
 <section id="compositions" aria-labelledby="compositions-title" className={'scroll-mt-24 border-t border-border py-8 ' + (active !== 'compositions' ? 'lg:hidden' : '')}><p className="text-xs font-bold uppercase tracking-widest text-editorial-link">02 / Sur le terrain</p><h2 id="compositions-title" className="mb-6 mt-2 text-3xl font-black text-foreground md:text-4xl">Les Compositions</h2><MatchLineup lineups={match.lineups} homeTeamId={match.homeTeamId} homeName={match.homeTeam.name} awayName={match.awayTeam.name}/></section>
 <section id="debat" aria-labelledby="debat-title" className={'scroll-mt-24 border-t border-border py-8 ' + (active !== 'discussion' ? 'lg:hidden' : '')}><p className="text-xs font-bold uppercase tracking-widest text-editorial-link">03 / À vous de jouer</p><h2 id="debat-title" className="mb-6 mt-2 text-3xl font-black text-foreground md:text-4xl">Le Débat</h2><MatchThread matchId={id} live={false} phase={phase} currentPhase={currentPhase} userId={userId} banned={!!thread[2]?.bannedUntil && thread[2].bannedUntil > new Date()} counts={Object.fromEntries(thread[1].map(row => [row.phase, row._count._all]))} comments={thread[0].map(row => ({ id: row.id, content: row.content, status: row.status, createdAt: row.createdAt.toISOString(), name: row.reader?.name ?? row.author?.name ?? "Compte supprimé", ownerId: row.readerId ?? row.authorId, parentId: row.parentId, parentName: row.parent?.status === "APPROVED" ? row.parent.reader?.name ?? row.parent.author?.name ?? "Compte supprimé" : null }))} /> </section>{vote?.status === "FINISHED" && <section aria-label="Vote homme du match" className="mt-8 rounded-xl border border-border bg-card p-5"><h2 className="text-xl font-bold text-foreground">Homme du match</h2><ManOfTheMatchVote matchId={id} candidates={vote.candidates} choice={vote.choice} signedIn={!!session?.user?.id}/><ManOfTheMatchResults results={vote.results}/></section>}<section id="articles-match" aria-labelledby="linked-articles-title" className="mt-12 border-t-2 border-border pt-6"><h2 id="linked-articles-title" className="mb-6 text-2xl font-black uppercase text-foreground">Articles liés au match</h2>{match.articles.length ? <div className="grid gap-5 md:grid-cols-3">{match.articles.map(article => <ArticleCard key={article.slug} article={article} headingLevel={3} />)}</div> : <p className="text-sm text-muted-foreground">Aucun article lié pour le moment.</p>}</section><AdSlotGate><AdSlot className="mt-10"/></AdSlotGate>
 </main><Footer/></>;
}
