import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CompetitionLiveTab, getCompetitionLiveMatches } from "@/components/CompetitionLiveTab";
import { LiveScoreRefresher } from "@/components/LiveScoreRefresher";
import { CompetitionHeader } from "@/components/CompetitionHeader";
import { CompetitionTabs, competitionTabs } from "@/components/CompetitionTabs";
import { CompetitionMatchList } from "@/components/CompetitionMatchList";
import { StandingsTable } from "@/components/StandingsTable";
import { StandingsLegend } from "@/components/StandingsLegend";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { Footer } from "@/components/Footer";
import { FollowButton } from "@/components/FollowButton";
import { auth } from "@/lib/auth";
import { getReaderFollows } from "@/lib/follows";
import { prisma } from "@/lib/prisma";
import { computeStandings } from "@/lib/standings";
import { getStoredChampionsLeagueStandings } from "@/lib/allsports-sync";
import { buildPageMetadata, jsonLdString, sportsOrganizationJsonLd } from "@/lib/seo";
export const revalidate = 60;
type Props = { params: Promise<{slug:string}>; searchParams:Promise<{tab?:string}> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const competition = await prisma.competition.findUnique({ where: { slug } });
  if (!competition) {
    return { title: "Compétition introuvable" };
  }
  return buildPageMetadata({
    title: competition.name,
    description: `Classement et derniers résultats de ${competition.name}${
      competition.country ? ` (${competition.country})` : ""
    }.`,
    path: `/competition/${competition.slug}`,
  });
}


export default async function CompetitionPage({params,searchParams}:Props){
 const {slug}=await params;const query=await searchParams;
 const active: keyof typeof competitionTabs = query.tab === "live" || query.tab === "resultats" || query.tab === "calendrier" ? query.tab : "classement";
 const competition=await prisma.competition.findUnique({where:{slug},include:{matches:{where:{status:{in:active==="calendrier"?["SCHEDULED","POSTPONED"]:["FINISHED"]},...(active==="calendrier"?{OR:[{status:"POSTPONED"},{scheduledAt:{gt:new Date()}}]}:{})},orderBy:{scheduledAt:active==="calendrier"?"asc":"desc"},include:{homeTeam:{select:{id:true,name:true,shortName:true,logoUrl:true}},awayTeam:{select:{id:true,name:true,shortName:true,logoUrl:true}}}}}});
 if(!competition)notFound();
 const liveMatches = await getCompetitionLiveMatches(slug);
 const liveCount = liveMatches.length;
 const hasLiveMatches = liveCount > 0;
 if (active === "live" && !hasLiveMatches) redirect(`/competition/${slug}?tab=classement`);
 const session = await auth();
 const [follows, clubs] = await Promise.all([
   session?.user?.id ? getReaderFollows(session.user.id) : null,
   prisma.team.findMany({ where: { OR: [{ homeMatches: { some: { competitionId: competition.id } } }, { awayMatches: { some: { competitionId: competition.id } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
 ]);
 const official=active==="classement"&&competition.externalId==="7"?await getStoredChampionsLeagueStandings(competition.season):null;
 const standings=active==="classement"?(competition.externalId==="7"?official?.rows??[]:computeStandings(competition.matches)):[];
 const totalMatchdays = ["ligue-1","premier-league","liga","serie-a","bundesliga"].includes(slug) && clubs.length > 1 ? 2 * (clubs.length - 1) : ["uefa-champions-league","uefa-europa-league"].includes(slug) ? 8 : slug === "uefa-conference-league" ? 6 : null;
 const logos=official?.logos??Object.fromEntries(competition.matches.flatMap(m=>[[m.homeTeam.id,m.homeTeam.logoUrl],[m.awayTeam.id,m.awayTeam.logoUrl]]));
 return <>{active === "live" && <meta name="robots" content="noindex, follow" />}<main id="contenu" className="mx-auto max-w-[1200px] px-4 py-8 md:px-6">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              sportsOrganizationJsonLd({
                name: competition.name,
                path: `/competition/${competition.slug}`,
                sport: competition.sport ?? null,
                country: competition.country ?? null,
              }),
            ),
          }}
        />


 <Link href="/scores" className="mb-6 inline-block text-sm font-bold text-editorial-link">← Tous les scores</Link>
 <CompetitionHeader competition={competition} action={<FollowButton id={competition.id} kind="competition" name={competition.name} following={follows?.followedCompetitions.some(item => item.id === competition.id) ?? false} signedIn={!!follows} />}/>
 <CompetitionTabs slug={slug} active={active} hasLiveMatches={hasLiveMatches} liveCount={liveCount}/>
 {hasLiveMatches && <LiveScoreRefresher hasLiveMatches={hasLiveMatches} />}
 <section aria-labelledby="competition-panel"><h2 id="competition-panel" className="mb-5 text-2xl font-black uppercase text-foreground">{competitionTabs[active]}</h2>
 {active==="live"?<CompetitionLiveTab slug={slug}/>:active==="classement"?<>{competition.externalId==="7"&&<p className="mb-4 text-sm text-muted-foreground">Phase de ligue uniquement : les qualifications et barrages ne comptent pas.{official?.updatedAt&&<> Dernière synchronisation : <time dateTime={official.updatedAt.toISOString()}>{official.updatedAt.toLocaleString("fr-FR",{timeZone:"Africa/Lagos"})}</time>.</>}</p>}<StandingsTable rows={standings} logos={logos} rules={competition} totalTeams={clubs.length}/><StandingsLegend rules={competition}/><p className="mt-3 text-xs text-muted-foreground">J : joués · G : gagnés · N : nuls · P : perdus · BP/BC : buts pour / contre · Diff : différence · Pts : points.</p></>:competition.matches.length?<CompetitionMatchList matches={competition.matches} totalMatchdays={totalMatchdays} />:<p className="border border-border bg-card p-6 text-muted-foreground">{active==="calendrier"?"Aucun match à venir dans le calendrier.":"Aucun résultat disponible pour le moment."}</p>}
 </section>
 <section id="clubs" className="mt-10 scroll-mt-32" aria-labelledby="follow-clubs">
   <h2 id="follow-clubs" className="mb-4 text-2xl font-bold">Suivre les clubs</h2>
   <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{clubs.map(team => <li key={team.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-4">
     <span className="font-semibold">{team.name}</span><FollowButton id={team.id} kind="team" name={team.name} following={follows?.followedTeams.some(item => item.id === team.id) ?? false} signedIn={!!follows} />
   </li>)}</ul>
   {!clubs.length && <p className="text-muted-foreground">Aucun club disponible pour cette compétition.</p>}
 </section><AdSlotGate><AdSlot className="mt-10"/></AdSlotGate>
 </main><Footer/></>;
}
