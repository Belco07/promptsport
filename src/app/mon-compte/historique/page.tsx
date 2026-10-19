import Link from "next/link";
import { redirect } from "next/navigation";
import { ArticleCard } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const metadata = { title: "Historique de lecture", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReadingHistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const history = await prisma.readingHistory.findMany({
    where: { readerId: session.user.id, article: { status: "PUBLISHED", publishedAt: { lte: new Date() } } },
    orderBy: [{ readAt: "desc" }, { id: "desc" }], take: 20,
    select: { readAt: true, article: { select: { id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, isPremium: true, format: true, category: { select: { name: true } }, author: { select: { name: true, slug: true } } } } },
  });
  return <><main id="contenu" className="mx-auto max-w-[1200px] px-4 py-10 text-foreground">
    <h1 className="text-3xl font-black">Historique de lecture</h1>
    <nav aria-label="Mes lectures" className="my-6 flex flex-wrap gap-4 text-sm font-semibold text-editorial-link"><Link href="/mon-compte">Mon compte</Link><Link href="/mon-compte/favoris">Favoris</Link></nav>
    <p className="mb-6 text-sm text-muted-foreground">Vos 20 derniers articles consultés, du plus récent au plus ancien.</p>
    {history.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{history.map(({ article, readAt }) => <div key={article.id} className="min-w-0"><p className="mb-2 text-xs text-muted-foreground">Dernière lecture : <time dateTime={readAt.toISOString()}>{readAt.toLocaleString("fr-FR", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</time></p><ArticleCard article={article} /></div>)}</div> : <p className="text-muted-foreground">Aucun article consulté pour le moment.</p>}
  </main><Footer /></>;
}
