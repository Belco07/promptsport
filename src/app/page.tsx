import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { HeroSection } from "@/components/home/HeroSection";
import { EditionSection } from "@/components/home/EditionSection";
import { EssentialsSidebar } from "@/components/home/EssentialsSidebar";
import { LiveBanner } from "@/components/home/LiveBanner";
import { CompetitionsGrid } from "@/components/CompetitionsGrid";
import { MostReadList } from "@/components/MostReadList";
import { SectionBlock } from "@/components/SectionBlock";
import { ThemeTabs, type ThemeTab } from "@/components/ThemeTabs";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { Footer } from "@/components/Footer";
import { prisma } from "@/lib/prisma";
import { getHomepageFeatured } from "@/lib/featured";
import { HOME_TITLE, SITE_DESCRIPTION, buildPageMetadata, jsonLdString, organizationJsonLd } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({ title: { absolute: HOME_TITLE }, description: SITE_DESCRIPTION, path: "/" });
export const revalidate = 60;
type HomeArticle = ArticleCardData & { id: string; contentLength: number };
const competitionSlugs = ["ligue-1", "premier-league", "liga", "serie-a", "bundesliga", "uefa-champions-league"];
const columns = Prisma.sql`a.id, a.format, a.slug, a.title, a.excerpt, a."coverImageUrl", a."publishedAt", a."isPremium", char_length(a.content) AS "contentLength", json_build_object('name',c.name) AS category, json_build_object('name',u.name,'slug',u.slug) AS author`;
const joins = Prisma.sql`FROM "Article" a JOIN "Category" c ON c.id=a."categoryId" JOIN "Author" u ON u.id=a."authorId"`;
const published = Prisma.sql`a.status='PUBLISHED' AND a."publishedAt" <= NOW()`;
function condition(section: string) {
  // WP16d : « mercato » filtre désormais sur le thème éditorial (tous sports),
  // et non plus sur une catégorie sportive.
  if (section === "mercato") return Prisma.sql`EXISTS (SELECT 1 FROM "_ArticleToTheme" j JOIN "Theme" t ON t.id = j."B" WHERE j."A" = a.id AND t.slug = 'mercato')`;
  if (section === "analyses") return Prisma.sql`a.format='ANALYSIS'`;
  return Prisma.sql`a.format='NEWS'`;
}

/**
 * Ligne du bloc d'onglets thématiques (WP16d) : le thème et, éventuellement,
 * l'un de ses 4 articles les plus récents. Un thème sans article publié produit
 * une ligne dont les colonnes d'article sont nulles — c'est ce qui permet
 * d'afficher « Aucun article pour ce thème. » sans requête supplémentaire.
 */
type ThemeTabRow = {
  themeId: string;
  themeName: string;
  themeSlug: string;
  themeColor: string | null;
  themeIcon: string | null;
  rn: number;
  id: string | null;
  format?: ArticleCardData["format"];
  slug: string | null;
  title: string | null;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: Date | string | null;
  isPremium: boolean | null;
  category: { name: string } | null;
  author: { name: string; slug: string | null } | null;
};

/** Regroupe les lignes du bloc d'onglets par thème, dans l'ordre reçu. */
function groupThemeTabs(rows: ThemeTabRow[]): ThemeTab[] {
  const tabs = new Map<string, ThemeTab>();
  for (const row of rows) {
    let tab = tabs.get(row.themeId);
    if (!tab) {
      tab = {
        id: row.themeId,
        name: row.themeName,
        slug: row.themeSlug,
        color: row.themeColor,
        icon: row.themeIcon,
        articles: [],
      };
      tabs.set(row.themeId, tab);
    }
    if (!row.slug) continue;
    tab.articles.push({
      format: row.format,
      slug: row.slug,
      title: row.title ?? "",
      excerpt: row.excerpt,
      coverImageUrl: row.coverImageUrl,
      publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
      isPremium: Boolean(row.isPremium),
      category: row.category,
      author: row.author,
    });
  }
  // Les thèmes qui ont des articles passent devant (le plus fourni d'abord) :
  // l'onglet ouvert par défaut montre ainsi toujours du contenu quand il y en a.
  return [...tabs.values()].sort(
    (a, b) => b.articles.length - a.articles.length || a.name.localeCompare(b.name, "fr"),
  );
}
const getEditorial = unstable_cache(async () => {
  const [featured, wire, mercato, analyses, competitions, ranked, themeTabs] = await Promise.all([
    getHomepageFeatured(),
    prisma.$queryRaw<HomeArticle[]>(Prisma.sql`SELECT ${columns} ${joins} WHERE ${published} AND a.format IN ('FLASH','NEWS') ORDER BY (a.format='FLASH') DESC, a."publishedAt" DESC, a.id DESC LIMIT 8`),
    // WP16d : le bloc « Mercato » suit le thème éditorial, tous sports confondus.
    prisma.$queryRaw<HomeArticle[]>(Prisma.sql`SELECT ${columns} ${joins} WHERE ${published} AND ${condition("mercato")} ORDER BY a."publishedAt" DESC, a.id DESC LIMIT 5`),
    prisma.$queryRaw<HomeArticle[]>(Prisma.sql`SELECT ${columns} ${joins} WHERE ${published} AND ${condition("analyses")} ORDER BY a."publishedAt" DESC, a.id DESC LIMIT 4`),
    prisma.competition.findMany({ where: { slug: { in: competitionSlugs } }, select: { slug: true, name: true } }),
    prisma.analyticsPageView.groupBy({ by: ["articleId"], where: { articleId: { not: null }, createdAt: { gte: new Date(Date.now()-7*86400000) }, article: { status: "PUBLISHED", publishedAt: { lte: new Date() } } }, _count: { articleId: true }, orderBy: [{ _count: { articleId: "desc" } }, { articleId: "asc" }], take: 5 }),
    // Onglets thématiques : une seule requête pour tous les thèmes actifs et
    // leurs 4 articles les plus récents (LEFT JOIN : un thème vide reste listé).
    // ROW_NUMBER renvoie bigint : le cast integer rend rn sérialisable par unstable_cache.
    prisma.$queryRaw<ThemeTabRow[]>(Prisma.sql`WITH ranked AS (SELECT ${columns}, t.id AS "themeId", t.name AS "themeName", t.slug AS "themeSlug", t.color AS "themeColor", t.icon AS "themeIcon", (ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY a."publishedAt" DESC NULLS LAST, a.id DESC))::integer AS rn FROM "Theme" t LEFT JOIN "_ArticleToTheme" j ON j."B" = t.id LEFT JOIN "Article" a ON a.id = j."A" AND ${published} LEFT JOIN "Category" c ON c.id = a."categoryId" LEFT JOIN "Author" u ON u.id = a."authorId" WHERE t.active = true) SELECT * FROM ranked WHERE rn <= 4 ORDER BY "themeName" ASC, rn ASC`),
  ]);
  // One batched lookup: groupBy cannot include the article relation (no N+1).
  const popular = ranked.length ? await prisma.article.findMany({ where: { id: { in: ranked.flatMap(row => row.articleId ? [row.articleId] : []) } }, select: { id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, isPremium: true, category: { select: { name: true } }, author: { select: { name: true, slug: true } } } }) : [];
  return { featured: featured.articles, urgent: featured.urgent, wire, mercato, analyses, competitions: competitions.sort((a,b) => competitionSlugs.indexOf(a.slug)-competitionSlugs.indexOf(b.slug)), popular: ranked.flatMap(row => popular.filter(article => article.id===row.articleId)), themeTabs };
}, ["home-editorial-featured-slots"], { revalidate: 60 });
const getLatest = unstable_cache(async (page: number, section: string) => prisma.$queryRaw<HomeArticle[]>(Prisma.sql`SELECT ${columns} ${joins} WHERE ${published} AND ${condition(section)} ORDER BY a."publishedAt" DESC, a.id DESC LIMIT 13 OFFSET ${(page-1)*12}`), ["home-latest-wp15a"], { revalidate: 60 });
function ArticleGrid({ articles }: { articles: ArticleCardData[] }) {
  return articles.length ? <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">{articles.map(article => <ArticleCard key={article.slug} article={article} headingLevel={3} />)}</div> : <p className="py-6 text-sm text-muted-foreground">Les prochaines publications apparaîtront ici.</p>;
}
export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string; rubrique?: string }> }) {
  const params = await searchParams;
  const page = /^\d{1,4}$/.test(params.page ?? "") ? Math.max(1, Number(params.page)) : 1;
  const section = ["mercato", "analyses"].includes(params.rubrique ?? "") ? params.rubrique! : "";
  const [cached, cachedLatest] = await Promise.all([getEditorial(), getLatest(page, section)]);
  // The persistent cache serializes Dates as strings; restore them before rendering.
  const restoreDates = <T extends ArticleCardData,>(articles: T[]): T[] => articles.map(article => ({ ...article, publishedAt: article.publishedAt ? new Date(article.publishedAt) : null }));
  const editorial = { ...cached, featured: restoreDates(cached.featured), wire: restoreDates(cached.wire), mercato: restoreDates(cached.mercato), analyses: restoreDates(cached.analyses), popular: restoreDates(cached.popular) };
  // WP16d : les onglets thématiques sont groupés ici, une seule requête en amont.
  const themeTabs = groupThemeTabs(cached.themeTabs);
  const latest = restoreDates(cachedLatest);
  const [lead, ...secondary] = editorial.featured;
  const unique = (articles: ArticleCardData[]) => [...new Map(articles.map(article => [article.slug, article])).values()];
  const essentials = unique([...secondary, ...editorial.wire]).filter(article => article.slug !== lead?.slug).slice(0, 3);
  const headlines = unique([...secondary, ...editorial.wire.filter(article => article.format === "NEWS"), ...latest.filter(article => article.format === "NEWS")]).filter(article => article.slug !== lead?.slug).slice(0, 3);
  const briefs = [...editorial.wire].sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)).slice(0, 5);
  const kicker = cached.themeTabs.find(row => row.id === lead?.id)?.themeName;
  const editionDate = new Date();
  const pageHref = (value: number) => `/?page=${value}${section ? `&rubrique=${section}` : ""}#derniers-articles`;
  return <><main id="contenu" className="mx-auto max-w-[1280px] space-y-10 px-4 pb-10 pt-6 sm:px-6">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(organizationJsonLd()) }} />
    <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-foreground pb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground"><p>Le sport. Sans détour.</p><p className="flex flex-wrap gap-x-4 gap-y-1"><span className="text-editorial-link">Édition du jour</span><time dateTime={editionDate.toISOString()}>{editionDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" })}</time></p></div>
    <div className="grid grid-cols-1 gap-x-7 gap-y-10 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(240px,.95fr)]">
      <HeroSection article={lead} kicker={kicker} />
      <LiveBanner />
      <EssentialsSidebar essentials={essentials} wire={briefs} />
      <EditionSection id="analyses" title="Analyses" articles={editorial.analyses.slice(0, 2)} href="/?rubrique=analyses#derniers-articles" />
      <EditionSection id="mercato" title="Mercato" articles={editorial.mercato.slice(0, 3)} href="/theme/mercato" />
      <EditionSection id="une" title="À la Une" articles={headlines} href="/#derniers-articles" />
    </div>
    <SectionBlock id="themes" title="Thèmes" description="Mercato, tactique, interviews : les sujets qui traversent tous les sports."><ThemeTabs themes={themeTabs} /><p className="mt-6"><Link href="/themes" className="text-sm font-bold text-foreground hover:underline">Tous les thèmes →</Link></p></SectionBlock>
    <AdSlotGate><AdSlot /></AdSlotGate>
    <SectionBlock id="competitions" title="Compétitions" href="/scores"><CompetitionsGrid competitions={editorial.competitions} /></SectionBlock>
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]"><SectionBlock id="plus-lus" title="Les plus lus" description="Les articles les plus consultés ces 7 derniers jours"><MostReadList articles={editorial.popular} /></SectionBlock><aside className="space-y-6"><section className="border border-border bg-card p-6 text-foreground"><p className="text-xs font-bold uppercase">PromptSport +</p><h2 className="my-3 text-3xl font-black">La passion va plus loin.</h2><p className="mb-5 text-sm text-muted-foreground">Analyses, décryptages et articles premium. Vivez le sport avec un temps d’avance.</p><Link href="/abonnement" className="font-bold underline underline-offset-4">Découvrir les offres →</Link></section><AdSlotGate><AdSlot format="rectangle" /></AdSlotGate></aside></div>
    <SectionBlock id="derniers-articles" title={section ? `Derniers articles · ${section}` : "Derniers articles"}>
      <div data-latest-page={page}><ArticleGrid articles={latest.slice(0,12)} /></div>
      <nav aria-label="Pagination des articles" className="mt-7 flex flex-wrap items-center justify-center gap-5 text-sm text-foreground">{page>1 && <Link href={pageHref(page-1)} rel="prev" className="border border-border px-5 py-3 font-bold">← Précédents</Link>}<span className="text-muted-foreground">Page {page}</span>{latest.length>12 && <Link href={pageHref(page+1)} rel="next" className="border border-border bg-card px-5 py-3 font-bold">Voir plus →</Link>}{section && <Link href="/#derniers-articles" className="underline">Toutes les rubriques</Link>}</nav>
    </SectionBlock>
    <section aria-labelledby="encart-newsletter" className="flex flex-col justify-between gap-6 border-y-2 border-border bg-card py-7 text-foreground md:flex-row md:items-center"><div><p className="text-xs font-bold uppercase text-muted-foreground">Le meilleur du sport, dans votre boîte mail</p><h2 id="encart-newsletter" className="my-2 text-2xl font-black">Ne restez pas sur la touche.</h2><p className="text-sm text-muted-foreground">Recevez l’essentiel de l’actualité sportive. Désabonnement en un clic.</p></div><Link href="/newsletter" className="shrink-0 border border-border px-5 py-3 text-sm font-bold">S’inscrire à la newsletter →</Link></section>
  </main><Footer /></>;
}
