import type { Metadata } from "next";
import Link from "next/link";
import { ArticleCard } from "@/components/ArticleCard";
import { SearchBar } from "@/components/SearchBar";
import { SearchFilters } from "@/components/SearchFilters";
import { Footer } from "@/components/Footer";
import { prisma } from "@/lib/prisma";
import { searchArticles, SearchValidationError, type SearchResults } from "@/lib/search";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Recherche",
  description: "Recherchez un article, un auteur ou un sujet sur PromptSport.",
  robots: { index: false, follow: true },
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  const keys = ["q", "format", "category", "theme", "from", "to", "page"];
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) params.set(key, value.trim());
  }
  const q = params.get("q") ?? "";
  const [categories, themes] = await Promise.all([
    prisma.category.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } }),
    prisma.theme.findMany({ where: { active: true }, select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  let results: SearchResults | undefined;
  let error: string | undefined;
  if (q) {
    try {
      if (keys.some(key => Array.isArray(raw[key]))) throw new SearchValidationError("Chaque filtre ne doit être fourni qu’une fois.");
      if (params.has("page") && !/^\d+$/.test(params.get("page")!)) throw new SearchValidationError("Le numéro de page doit être un entier positif.");
      results = await searchArticles({ q, limit: 12, page: Number(params.get("page") ?? 1),
        format: params.get("format") ?? undefined, category: params.get("category") ?? undefined,
        theme: params.get("theme") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    } catch (cause) {
      if (cause instanceof SearchValidationError) error = cause.message;
      else { console.error("Search page failed", cause instanceof Error ? cause.name : "Unknown error"); error = "La recherche est momentanément indisponible. Réessayez dans quelques instants."; }
    }
  }
  function pageLink(page: number) {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    return `/recherche?${next}`;
  }
  const buttonClass = "rounded-md border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted";
  return <>
    <main id="contenu" className="mx-auto max-w-[1200px] space-y-7 px-4 py-8 md:py-12">
      <h1 className="text-3xl font-black text-foreground md:text-4xl">Recherche</h1>
      <SearchBar />
      <SearchFilters categories={categories} themes={themes} />
      <div role="status" aria-live="polite" aria-atomic="true" className="text-foreground">
        {!q ? <p>Commencez votre recherche… Saisissez au moins deux caractères.</p>
          : error ? <p>{error}</p>
          : results ? <p className="font-semibold">{results.total} résultat{results.total !== 1 ? "s" : ""} pour « {q} »</p> : null}
      </div>
      {results && <section aria-label="Résultats de recherche" className="space-y-8">
        {results.articles.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {results.articles.map(article => <ArticleCard key={article.id} article={{ ...article, publishedAt: new Date(article.publishedAt) }} />)}
        </div> : <div className="rounded-md border border-border bg-card p-6 text-foreground">
          <h2 className="text-xl font-bold">{results.total ? "Cette page ne contient aucun résultat" : "Aucun résultat"}</h2>
          <p className="mt-2 text-muted-foreground">{results.total ? "Revenez à la première page pour consulter les résultats." : "Essayez d’autres mots-clés ou élargissez vos filtres."}</p>
          {results.total > 0 && <Link href={pageLink(1)} className="mt-4 inline-block font-semibold underline">Première page</Link>}
        </div>}
        {results.totalPages > 0 && <nav aria-label="Pagination des résultats" className="flex flex-wrap items-center justify-center gap-4">
          {results.page > 1 ? <Link href={pageLink(results.page - 1)} className={buttonClass} rel="prev">Précédent</Link> : <span aria-disabled="true" className={`${buttonClass} opacity-50`}>Précédent</span>}
          <span className="text-sm text-muted-foreground">Page {results.page} sur {results.totalPages}</span>
          {results.page < results.totalPages ? <Link href={pageLink(results.page + 1)} className={buttonClass} rel="next">Suivant</Link> : <span aria-disabled="true" className={`${buttonClass} opacity-50`}>Suivant</span>}
        </nav>}
      </section>}
    </main>
    <Footer />
  </>;
}
