import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Star } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFollowedArticles, getReaderFollows, getFollowedStandings } from "@/lib/follows";
import { StandingsLegend } from "@/components/StandingsLegend";
import { ArticleCard } from "@/components/ArticleCard";
import { MatchCard } from "@/components/MatchCard";
import { StandingsTable } from "@/components/StandingsTable";
import { FollowPill } from "@/components/ui/FollowPill";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mon Sport", robots: { index: false, follow: true } };

export default async function MySportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=%2Fmon-sport");
  const follows = await getReaderFollows(session.user.id);
  if (!follows) redirect("/login");
  const teamIds = follows.followedTeams.map(team => team.id);
  const competitionIds = follows.followedCompetitions.map(competition => competition.id);
  const clubFilter = { OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }] };
  const matchRelations = { homeTeam: true, awayTeam: true, competition: { select: { name: true } } };
  const [articles, upcoming, results, standings, discover] = await Promise.all([
    getFollowedArticles([...follows.followedTeams, ...follows.followedCompetitions]),
    teamIds.length ? prisma.match.findMany({ where: { ...clubFilter, status: "SCHEDULED", scheduledAt: { gte: new Date() } }, include: matchRelations, orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], take: 20 }) : [],
    teamIds.length ? prisma.match.findMany({ where: { ...clubFilter, status: "FINISHED" }, include: matchRelations, orderBy: [{ scheduledAt: "desc" }, { id: "desc" }], take: 20 }) : [],
    getFollowedStandings(competitionIds),
    prisma.competition.findMany({ select: { id: true, name: true, slug: true, country: true }, orderBy: { name: "asc" } }),
  ]);

  return <><main id="contenu" className="mx-auto max-w-[1280px] space-y-12 px-4 py-10 md:px-6">
    <header className="border-b border-border pb-8">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-editorial-link"><Star size={18} aria-hidden="true" /> Votre sélection</p>
      <h1 className="text-4xl font-black uppercase tracking-tight md:text-5xl">Mon Sport</h1>
      <p className="mt-4 text-muted-foreground">Les actualités de vos favoris, les matchs de vos clubs et les classements de vos compétitions.</p>
    </header>

    {!teamIds.length && <section className="rounded-md border border-border bg-muted p-6">
      <h2 className="text-xl font-bold">Suivez votre premier club</h2>
      <p className="mt-2 text-muted-foreground">Ouvrez une compétition et choisissez vos équipes pour personnaliser votre fil.</p>
      <Link href="#decouvrir" className="mt-4 inline-block font-bold text-editorial-link hover:underline">Découvrir les clubs →</Link>
    </section>}

    {(teamIds.length > 0 || competitionIds.length > 0) && <section aria-labelledby="my-favorites">
      <h2 id="my-favorites" className="mb-6 text-2xl font-black uppercase text-foreground">Mes favoris</h2>
      <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {follows.followedTeams.map(team => <FollowPill key={team.id} id={team.id} kind="team" name={team.name} logoUrl={null} slug={team.slug} following signedIn />)}
        {follows.followedCompetitions.map(competition => <FollowPill key={competition.id} id={competition.id} kind="competition" name={competition.name} logoUrl={null} slug={competition.slug} following signedIn />)}
      </div>
    </section>}

    <section aria-labelledby="my-news">
      <h2 id="my-news" className="mb-5 text-2xl font-black uppercase">Mon actualité</h2>
      {articles.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{articles.map(article => <ArticleCard key={article.slug} article={article} headingLevel={3} />)}</div> : <p className="text-muted-foreground">{teamIds.length || competitionIds.length ? "Aucun article récent ne mentionne vos favoris dans son titre." : "Suivez des clubs ou des compétitions pour retrouver leurs actualités ici."}</p>}
    </section>

    <section aria-labelledby="my-upcoming">
      <h2 id="my-upcoming" className="mb-5 text-2xl font-black uppercase">Prochains matchs</h2>
      {upcoming.length ? <div className="grid gap-3 md:grid-cols-2">{upcoming.map(match => <MatchCard key={match.id} match={match} compact />)}</div> : <p className="text-muted-foreground">Aucun match à venir pour vos clubs suivis.</p>}
    </section>

    <section aria-labelledby="my-results">
      <h2 id="my-results" className="mb-5 text-2xl font-black uppercase">Derniers résultats</h2>
      {results.length ? <div className="grid gap-3 md:grid-cols-2">{results.map(match => <MatchCard key={match.id} match={match} compact />)}</div> : <p className="text-muted-foreground">Aucun résultat disponible pour vos clubs suivis.</p>}
    </section>

    <section aria-labelledby="my-standings">
      <h2 id="my-standings" className="mb-5 text-2xl font-black uppercase">Mes classements</h2>
      {standings.length ? <div className="space-y-8">{standings.map(competition => <div key={competition.id}>
        <h3 className="mb-3 text-lg font-bold"><Link href={`/competition/${competition.slug}`} className="hover:text-editorial-link">{competition.name}</Link></h3>
        {competition.official && <p className="mb-3 text-sm text-muted-foreground">{competition.rows.length ? "Phase de ligue uniquement : les qualifications et barrages ne comptent pas." : "Classement officiel de la phase de ligue indisponible pour le moment."}</p>}
        {(!competition.official || competition.rows.length > 0) && <>
        <StandingsTable rows={competition.rows} competitionSlug={competition.slug} rules={competition} totalTeams={competition.totalTeams} logos={competition.logos} />
        <StandingsLegend rules={competition} />
        </>}
      </div>)}</div> : <p className="text-muted-foreground">Suivez une compétition pour afficher son classement.</p>}
    </section>

    <section id="decouvrir" className="scroll-mt-32 border-t border-border pt-8" aria-labelledby="discover-sports">
      <h2 id="discover-sports" className="mb-6 text-2xl font-black uppercase text-foreground">Découvrir les clubs et compétitions</h2>
      <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">{discover.map(competition => <FollowPill key={competition.id} id={competition.id} kind="competition" name={competition.name} logoUrl={null} slug={competition.slug} following={competitionIds.includes(competition.id)} signedIn />)}</div>
      {!discover.length && <p className="text-muted-foreground">Les compétitions seront bientôt disponibles.</p>}
    </section>
  </main><Footer /></>;
}
