import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { playerProfileKey } from "@/lib/slug";
import { buildPageMetadata, jsonLdString, absoluteUrl } from "@/lib/seo";
import { PlayerHeader } from "@/components/PlayerHeader";
import { PlayerStats } from "@/components/PlayerStats";
import { MatchCard } from "@/components/MatchCard";
import { ArticleCard } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }> };
const getPlayer = cache((slug: string) => prisma.player.findUnique({ where: { slug }, include: { team: { select: { id: true, name: true, slug: true, logoUrl: true } } } }));
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const player = await getPlayer((await params).slug);
  return player ? buildPageMetadata({ title: `${player.name} — ${player.team.name}, matchs et statistiques`, description: `${player.name} : buts, cartons et matchs documentés avec ${player.team.name}, ainsi que ses actualités.`, path: `/joueur/${player.slug}` }) : { title: "Joueur introuvable" };
}

export default async function PlayerPage({ params }: Props) {
  const player = await getPlayer((await params).slug);
  if (!player) notFound();
  const sameName = (name: string | null) => !!name && playerProfileKey(player.teamId, name) === playerProfileKey(player.teamId, player.name);
  const [teamMatches, articles] = await Promise.all([
    prisma.match.findMany({ where: { OR: [{ homeTeamId: player.teamId }, { awayTeamId: player.teamId }], status: { in: ["LIVE", "FINISHED"] } }, orderBy: [{ scheduledAt: "desc" }, { id: "asc" }], include: { homeTeam: true, awayTeam: true, competition: true, events: { where: { teamId: player.teamId } }, lineups: { where: { teamId: player.teamId }, select: { starters: true } } } }),
    prisma.article.findMany({ where: { status: "PUBLISHED", publishedAt: { lte: new Date() }, title: { contains: player.name, mode: "insensitive" } }, orderBy: { publishedAt: "desc" }, take: 6, select: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, isPremium: true, author: { select: { name: true, slug: true } }, category: { select: { name: true } } } }),
  ]);
  const matches = teamMatches.filter(match => match.events.some(event => sameName(event.playerName) || sameName(event.assistName)) || match.lineups.some(lineup => Array.isArray(lineup.starters) && lineup.starters.some(item => item && typeof item === "object" && !Array.isArray(item) && typeof item.name === "string" && sameName(item.name))));
  const ownEvents = matches.flatMap(match => match.events.filter(event => sameName(event.playerName)));
  return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 pb-8 md:px-6">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "Person", name: player.name, url: absoluteUrl(`/joueur/${player.slug}`), ...(player.position ? { jobTitle: player.position } : {}), memberOf: { "@type": "SportsTeam", name: player.team.name, url: absoluteUrl(`/club/${player.team.slug}`) } }) }}/>
    <div className="page-band">
    <Breadcrumbs items={[{ label: "Scores", href: "/scores" }, { label: player.team.name, href: `/club/${player.team.slug}` }, { label: player.name, href: `/joueur/${player.slug}` }]} />
    <PlayerHeader player={player}/>
    </div>
    <PlayerStats goals={ownEvents.filter(event => event.type === "GOAL").length} yellowCards={ownEvents.filter(event => event.type === "YELLOW_CARD").length} redCards={ownEvents.filter(event => event.type === "RED_CARD").length} played={matches.length}/>
    <section aria-labelledby="player-matches"><h2 id="player-matches" className="mb-5 text-2xl font-black">Derniers matchs documentés</h2>{matches.length ? <div className="space-y-3">{matches.slice(0, 10).map(match => <MatchCard key={match.id} match={match} compact/>)}</div> : <p className="text-muted-foreground">Aucun match documenté pour ce joueur.</p>}</section>
    <section aria-labelledby="player-articles" className="mt-10 border-t border-border pt-6"><h2 id="player-articles" className="mb-5 text-2xl font-black">Actualités de {player.name}</h2>{articles.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{articles.map(article => <ArticleCard key={article.slug} article={article} headingLevel={3}/>)}</div> : <p className="text-muted-foreground">Aucun article lié à ce joueur pour le moment.</p>}</section>
  </main><Footer/></>;
}
