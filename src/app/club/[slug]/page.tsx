import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { followTerms, getReaderFollows } from "@/lib/follows";
import { buildPageMetadata, jsonLdString, absoluteUrl } from "@/lib/seo";
import { ClubHeader } from "@/components/ClubHeader";
import { ClubTabs, clubTabs, type ClubTab } from "@/components/ClubTabs";
import { PlayerList } from "@/components/PlayerList";
import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { MatchCard } from "@/components/MatchCard";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; page?: string }> };
const getClub = cache((slug: string) => prisma.team.findUnique({ where: { slug }, include: {
  homeMatches: { distinct: ["competitionId"], take: 8, orderBy: { scheduledAt: "desc" }, select: { competition: { select: { name: true, slug: true } } } },
  awayMatches: { distinct: ["competitionId"], take: 8, orderBy: { scheduledAt: "desc" }, select: { competition: { select: { name: true, slug: true } } } },
} }));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const club = await getClub((await params).slug);
  if (!club) return { title: "Club introuvable" };
  const query = await searchParams;
  const page = query.page && /^\d+$/.test(query.page) ? Number(query.page) : 1;
  return buildPageMetadata({ title: `${club.name} — actualités, résultats et joueurs`, description: `Suivez ${club.name} : actualités, calendrier, résultats et joueurs identifiés dans les matchs.`, path: `/club/${club.slug}${(!query.tab || query.tab === "actualites") && page > 1 ? `?tab=actualites&page=${page}` : ""}` });
}

export default async function ClubPage({ params, searchParams }: Props) {
  const club = await getClub((await params).slug);
  if (!club) notFound();
  const query = await searchParams;
  const tab: ClubTab = query.tab && Object.hasOwn(clubTabs, query.tab) ? query.tab as ClubTab : "actualites";
  const page = query.page && /^\d+$/.test(query.page) ? Math.min(10000, Math.max(1, Number(query.page))) : 1;
  const competitions = [...new Map([...club.homeMatches, ...club.awayMatches].map(match => [match.competition.slug, match.competition])).values()];
  const session = await auth();
  const follows = session?.user?.id ? await getReaderFollows(session.user.id) : null;
  const now = new Date();
  // One dataset query for the selected tab; common header lookup is cached
  // within the request and shared with generateMetadata.
  const articles = tab === "actualites" ? await prisma.$queryRaw<ArticleCardData[]>(Prisma.sql`
    SELECT a.slug, a.title, a.excerpt, a."coverImageUrl", a."publishedAt", a."isPremium",
      jsonb_build_object('name', au.name, 'slug', au.slug) AS author,
      jsonb_build_object('name', c.name) AS category
    FROM "Article" a JOIN "Author" au ON au.id = a."authorId" JOIN "Category" c ON c.id = a."categoryId"
    WHERE a.status = 'PUBLISHED' AND a."publishedAt" <= ${now}
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(${JSON.stringify(followTerms(club))}::jsonb) term
        WHERE strpos(' ' || regexp_replace(lower(a.title), '[^[:alnum:]]+', ' ', 'g') || ' ', ' ' || term || ' ') > 0)
    ORDER BY a."publishedAt" DESC, a.id DESC LIMIT 13 OFFSET ${(page - 1) * 12}
  `) : [];
  const matches = tab === "calendrier" || tab === "resultats" ? await prisma.match.findMany({
    where: { OR: [{ homeTeamId: club.id }, { awayTeamId: club.id }], ...(tab === "resultats" ? { status: "FINISHED" } : { status: { in: ["SCHEDULED", "POSTPONED", "LIVE"] }, scheduledAt: { gte: new Date(now.getTime() - 10800000) } }) },
    include: { homeTeam: true, awayTeam: true, competition: true }, orderBy: [{ scheduledAt: tab === "resultats" ? "desc" : "asc" }, { id: "asc" }], take: 30,
  }) : [];
  const players = tab === "effectif" ? await prisma.player.findMany({ where: { teamId: club.id }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, position: true } }) : [];
  return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 py-8 md:px-6">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "SportsTeam", name: club.name, sport: club.sport, url: absoluteUrl(`/club/${club.slug}`), ...(club.logoUrl ? { logo: club.logoUrl } : {}), ...(club.country ? { location: { "@type": "Country", name: club.country } } : {}) }) }}/>
    <Link href="/scores" className="mb-6 inline-block text-sm font-bold text-editorial-link">← Tous les scores</Link>
    <ClubHeader club={club} competitions={competitions} signedIn={!!session?.user?.id} following={!!follows?.followedTeams.some(team => team.id === club.id)}/>
    <ClubTabs slug={club.slug} active={tab}/>
    <section aria-labelledby="club-panel"><h2 id="club-panel" className="mb-6 text-2xl font-black text-foreground">{clubTabs[tab]}</h2>
      {tab === "actualites" ? <>{articles.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{articles.slice(0, 12).map(article => <ArticleCard key={article.slug} article={article} headingLevel={3}/>)}</div> : <p className="text-muted-foreground">Aucun article disponible pour ce club{page > 1 ? " à cette page" : ""}.</p>}<nav aria-label="Pagination des actualités" className="mt-8 flex items-center justify-between gap-4">{page > 1 ? <Link href={`/club/${club.slug}?tab=actualites&page=${page - 1}`} className="font-bold text-editorial-link">← Page précédente</Link> : <span/>}<span className="text-sm text-muted-foreground">Page {page}</span>{articles.length > 12 ? <Link href={`/club/${club.slug}?tab=actualites&page=${page + 1}`} className="font-bold text-editorial-link">Page suivante →</Link> : <span/>}</nav></> : tab === "effectif" ? <PlayerList players={players}/> : matches.length ? <div className="space-y-3">{matches.map(match => <MatchCard key={match.id} match={match} compact/>)}</div> : <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">{tab === "resultats" ? "Aucun résultat enregistré pour ce club." : "Aucun match à venir enregistré pour ce club."}</p>}
    </section>
  </main><Footer/></>;
}
