import Link from "next/link";
import { PremiumBadge } from "@/components/PremiumBadge";
import type { ArticleCardData } from "@/components/ArticleCard";

export function MostReadList({ articles }: { articles: ArticleCardData[] }) {
  if (!articles.length) return <p className="border border-border bg-card p-5 text-sm text-muted-foreground">Le classement apparaîtra dès que des articles auront été consultés cette semaine.</p>;
  return <ol className="divide-y divide-border" data-most-read>{articles.map((article, index) => <li key={article.slug} className="flex items-start gap-5 py-4 first:pt-0">
    <span aria-hidden="true" className="w-10 shrink-0 text-4xl font-black tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
    <div><div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground"><span>{article.category?.name ?? "Actualité"}</span>{article.isPremium && <PremiumBadge />}</div>
      <h3 className="text-lg font-bold leading-snug text-foreground"><Link href={`/article/${article.slug}`} className="hover:underline">{article.title}</Link></h3></div>
  </li>)}</ol>;
}
