import Link from "next/link";
import { redirect } from "next/navigation";
import { ArticleCard } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Mes favoris", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [bookmarks, reader] = await Promise.all([
    prisma.bookmark.findMany({
      where: { readerId: session.user.id, article: { status: "PUBLISHED", publishedAt: { lte: new Date() } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { article: { select: { id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, isPremium: true, format: true, category: { select: { name: true } }, author: { select: { name: true, slug: true } } } } },
    }),
    prisma.author.findUnique({ where: { id: session.user.id }, select: { favoriteCompetitions: true } }),
  ]);
  const competitions = await prisma.competition.findMany({ where: { slug: { in: reader?.favoriteCompetitions ?? [] } }, select: { slug: true, name: true }, orderBy: { name: "asc" } });
  return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 py-10 text-foreground">
    <h1 className="text-3xl font-black">Mes favoris</h1>
    <nav aria-label="Mes lectures" className="my-6 flex flex-wrap gap-4 text-sm font-semibold text-editorial-link"><Link href="/mon-compte">Mon compte</Link><Link href="/mon-compte/historique">Historique</Link></nav>
    <section aria-labelledby="saved-articles-heading">
      <h2 id="saved-articles-heading" className="mb-6 text-2xl font-bold">Articles sauvegardés</h2>
      {bookmarks.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{bookmarks.map(({ article }) => <ArticleCard key={article.id} article={article} headingLevel={3} bookmark={{ articleId: article.id, saved: true, showLabel: true }} />)}</div> : <p className="text-muted-foreground">Aucun article sauvegardé pour le moment. Utilisez le signet d’un article pour le retrouver ici.</p>}
    </section>
    <section aria-labelledby="favorite-competitions-heading" className="mt-12 border-t border-border pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="favorite-competitions-heading" className="text-xl font-bold">Mes compétitions favorites</h2><Link href="/mon-compte/favoris/personnaliser" className="text-sm font-semibold text-editorial-link hover:underline">Personnaliser</Link></div>
      {competitions.length ? <ul className="mt-4 flex flex-wrap gap-3">{competitions.map(competition => <li key={competition.slug}><Link href={`/competition/${competition.slug}`} className="inline-block rounded-full bg-muted px-4 py-2 text-sm font-semibold hover:underline">{competition.name}</Link></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Choisissez vos compétitions pour retrouver leurs résultats et classements ici.</p>}
    </section>
  </main><Footer /></>;
}
