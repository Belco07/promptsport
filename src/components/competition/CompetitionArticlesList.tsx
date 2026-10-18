import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";

export type CompetitionArticleItem = ArticleCardData;

/** Onglet "Actualités" : articles, flashes et analyses liés à la compétition. */
export function CompetitionArticlesList({ articles }: { articles: CompetitionArticleItem[] }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {articles.length ? (
        articles.map((article) => (
          <ArticleCard key={article.slug} article={article} headingLevel={3} />
        ))
      ) : (
        <p className="col-span-full text-muted-foreground text-center py-12">
          Aucun article publié pour cette compétition pour le moment.
        </p>
      )}
    </div>
  );
}
