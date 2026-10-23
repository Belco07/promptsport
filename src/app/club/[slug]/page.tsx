import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { followTerms, getReaderFollows } from "@/lib/follows";
import { buildPageMetadata, jsonLdString, absoluteUrl } from "@/lib/seo";
import { ClubHeader } from "@/components/ClubHeader";
import { ClubTabs, clubTabs, type ClubTab } from "@/components/club/ClubTabs";
import { PlayerList } from "@/components/PlayerList";
import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { teamLogoSource } from "@/components/MatchCard";
import { ScoreRow } from "@/components/ScoreRow";
import { CompetitionLogo } from "@/components/CompetitionLogo";
import { groupCompetitionMatches } from "@/components/CompetitionMatchList";
import { FollowClubButton } from "@/components/club/FollowClubButton";
import { FollowPill } from "@/components/ui/FollowPill";
import { RivalryBlock } from "@/components/club/RivalryBlock";
import { ClubPulse } from "@/components/club/ClubPulse";
import { ManOfTheMatchVote } from "@/components/club/ManOfTheMatchVote";
import { ManOfTheMatchResults } from "@/components/club/ManOfTheMatchResults";
import { getClubPulse, getMatchVoteData, getClubRivalries } from "@/lib/club-digest";
import { Footer } from "@/components/Footer";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; page?: string }> };
const getClub = cache((slug: string) => prisma.team.findUnique({ where: { slug }, include: {
  homeMatches: { distinct: ["competitionId"], take: 8, orderBy: { scheduledAt: "desc" }, select: { competition: { select: { name: true, slug: true, id: true, color: true } } } },
  awayMatches: { distinct: ["competitionId"], take: 8, orderBy: { scheduledAt: "desc" }, select: { competition: { select: { name: true, slug: true, id: true, color: true } } } },
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
  const competitionsMap = new Map(
    [...club.homeMatches, ...club.awayMatches].map((match) => [match.competition.slug, match.competition]),
  );
  const competitions = [...competitionsMap.values()];
  const competitionIds = competitions.map((c) => c.id);
  const accentColor: string | undefined = competitions[0]?.color ?? undefined;
  const relatedClubs =
    competitionIds.length > 0
      ? await prisma.team.findMany({
          where: {
            OR: [
              { homeMatches: { some: { competitionId: { in: competitionIds } } } },
              { awayMatches: { some: { competitionId: { in: competitionIds } } } },
            ],
            NOT: { id: club.id },
          },
          select: { id: true, name: true, slug: true, logoUrl: true },
          take: 6,
          orderBy: { name: "asc" },
        })
      : [];
  const session = await auth();
  const follows = session?.user?.id ? await getReaderFollows(session.user.id) : null;
  const [pulse, rivalries, reader] = await Promise.all([getClubPulse(club.id), tab === "rivalites" ? getClubRivalries(club.id) : Promise.resolve([]), session?.user?.id ? prisma.author.findUnique({ where: { id: session.user.id }, select: { favoriteClubId: true } }) : null]);
  const vote = pulse.last ? await getMatchVoteData(pulse.last.id, session?.user?.id ?? null) : null;
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
  const matchGroups = new Map<string, { competition: typeof matches[number]["competition"]; matches: typeof matches }>();
  for (const match of matches) {
    const group = matchGroups.get(match.competitionId) ?? { competition: match.competition, matches: [] };
    group.matches.push(match);
    matchGroups.set(match.competitionId, group);
  }
  const players = tab === "effectif" ? await prisma.player.findMany({ where: { teamId: club.id }, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, position: true } }) : [];
  return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 pb-8 md:px-6">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString({ "@context": "https://schema.org", "@type": "SportsTeam", name: club.name, sport: club.sport, url: absoluteUrl(`/club/${club.slug}`), ...(club.logoUrl ? { logo: club.logoUrl } : {}), ...(club.country ? { location: { "@type": "Country", name: club.country } } : {}) }) }}/>
    <div className="page-band">
    <Breadcrumbs items={[{ label: "Scores", href: "/scores" }, { label: club.name, href: `/club/${club.slug}` }]} />
    <ClubHeader club={club} competitions={competitions} signedIn={!!session?.user?.id} following={!!follows?.followedTeams.some(team => team.id === club.id)} accentColor={accentColor}/>
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">{session?.user?.id && <FollowClubButton clubId={club.id} preferred={reader?.favoriteClubId === club.id}/>}<a href={`/api/club/${club.slug}/calendar.ics`} className="inline-flex h-10 items-center rounded-[13px] border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary">Ajouter à mon agenda</a><Link href="/mon-compte/preferences" className="inline-flex h-10 items-center text-sm font-semibold text-editorial-link hover:underline">Gérer mon digest hebdomadaire</Link></div>
    </div>
    <ClubPulse pulse={pulse}/>

    <ClubTabs slug={club.slug} active={tab} accentColor={accentColor}/>
    <section aria-labelledby="club-panel"><h2 id="club-panel" className="mb-6 text-2xl font-black text-foreground">{clubTabs[tab]}</h2>
      {tab === "actualites" ? <>{articles.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{articles.slice(0, 12).map(article => <ArticleCard key={article.slug} article={article} headingLevel={3}/>)}</div> : <p className="text-muted-foreground">Aucun article disponible pour ce club{page > 1 ? " à cette page" : ""}.</p>}<nav aria-label="Pagination des actualités" className="mt-8 flex items-center justify-between gap-4">{page > 1 ? <Link href={`/club/${club.slug}?tab=actualites&page=${page - 1}`} className="font-bold text-editorial-link">← Page précédente</Link> : <span/>}<span className="text-sm text-muted-foreground">Page {page}</span>{articles.length > 12 ? <Link href={`/club/${club.slug}?tab=actualites&page=${page + 1}`} className="font-bold text-editorial-link">Page suivante →</Link> : <span/>}</nav></> : tab === "rivalites" ? <RivalryBlock rivalries={rivalries}/> : tab === "stats" ? <div><p className="mb-4 text-sm text-muted-foreground">Saison {pulse.seasonLabel} · depuis juillet · matchs terminés avec un score renseigné.</p><dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">{[["Matchs",pulse.stats.played],["Victoires",pulse.stats.won],["Nuls",pulse.stats.drawn],["Défaites",pulse.stats.lost],["Buts marqués",pulse.stats.goalsFor],["Buts encaissés",pulse.stats.goalsAgainst]].map(([label,value]) => <div key={String(label)} className="rounded-xl border border-border bg-card p-5"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 text-3xl font-bold text-foreground">{value}</dd></div>)}</dl></div> : tab === "effectif" ? <PlayerList players={players}/> : matches.length ? <div className="space-y-7">{[...matchGroups.entries()].map(([key, group]) => <section key={key} aria-labelledby={`club-fixtures-${group.matches[0].id}`}>
        <Link href={`/competition/${group.competition.slug}`} className="mb-3 flex items-center gap-3"><CompetitionLogo slug={group.competition.slug}/><span><h3 id={`club-fixtures-${group.matches[0].id}`} className="text-xl font-black">{group.competition.name}</h3><span className="text-sm text-muted-foreground">{group.competition.country ?? group.competition.sport}</span></span></Link>
        <div className="overflow-hidden rounded-md bg-muted">{groupCompetitionMatches(group.matches, null).map(day => <div key={`${day.date}/${day.round}`}><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground"><time dateTime={day.date} className="capitalize">{day.dateLabel}</time><span>{day.round}</span></div><div className="divide-y divide-border">{day.matches.map(match => <ScoreRow key={match.id} match={{ ...match, homeTeam: { ...match.homeTeam, logoUrl: match.homeTeam.logoUrl ? teamLogoSource(match.homeTeam.logoUrl) : null }, awayTeam: { ...match.awayTeam, logoUrl: match.awayTeam.logoUrl ? teamLogoSource(match.awayTeam.logoUrl) : null } }}/>)}</div></div>)}</div>
      </section>)}</div> : <p className="rounded-lg border border-border bg-card p-6 text-muted-foreground">{tab === "resultats" ? "Aucun résultat enregistré pour ce club." : "Aucun match à venir enregistré pour ce club."}</p>}
    </section>
    {vote?.status === "FINISHED" && <section aria-label="Homme du dernier match" className="mt-10 rounded-xl border border-border bg-card p-5"><h2 className="text-xl font-bold text-foreground">Homme du dernier match</h2><Link className="text-sm text-editorial-link" href={`/match/${vote.id}`}>{pulse.last?.home} – {pulse.last?.away}</Link>{vote.results[0] && <div className="my-4 flex items-center gap-3"><span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-xl font-bold text-foreground">{vote.results[0].name.charAt(0)}</span><p className="text-foreground"><strong className="block">{vote.results[0].name}</strong><span className="text-sm text-muted-foreground">{vote.results[0].percentage.toLocaleString("fr-FR", {maximumFractionDigits:1})} % des votes</span></p></div>}<ManOfTheMatchVote matchId={vote.id} candidates={vote.candidates} choice={vote.choice} signedIn={!!session?.user?.id}/><ManOfTheMatchResults results={vote.results}/></section>}
    {relatedClubs.length > 0 && (
      <section id="clubs-a-suivre" className="mt-12 scroll-mt-32" aria-labelledby="clubs-a-suivre-title">
        <h2 id="clubs-a-suivre-title" className="mb-6 section-title">
          À suivre · Autres clubs de vos compétitions
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-8">
          {relatedClubs.map((team) => (
            <FollowPill
              key={team.id}
              id={team.id}
              kind="team"
              name={team.name}
              logoUrl={team.logoUrl}
              slug={team.slug}
              following={follows?.followedTeams.some((t) => t.id === team.id) ?? false}
              signedIn={!!session?.user?.id}
            />
          ))}
        </div>
      </section>
    )}
  </main><Footer/></>;
}
