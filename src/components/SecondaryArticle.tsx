import Image from "next/image";
import Link from "next/link";
import { Trophy } from "lucide-react";
import type { ArticleCardData } from "@/components/ArticleCard";
import { PremiumBadge } from "@/components/PremiumBadge";

export function SecondaryArticle({ article }: { article: ArticleCardData }) {
  return <article data-home-secondary className="min-w-0 border-b border-border pb-4 text-foreground">
    <Link href={`/article/${article.slug}`} className="group block">
      <div className="relative aspect-video overflow-hidden bg-card">
        {article.coverImageUrl ? <Image src={article.coverImageUrl} alt="" fill priority sizes="(min-width: 1024px) 270px, (min-width: 768px) 30vw, 94vw" className="object-cover" /> : <div className="flex h-full items-center justify-center"><Trophy aria-hidden="true" size={32} /></div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><span>{article.category?.name ?? "Actualité"}</span>{article.isPremium && <PremiumBadge />}</div>
      <h3 className="mt-2 text-lg font-extrabold leading-tight tracking-tight group-hover:underline">{article.title}</h3>
    </Link>
  </article>;
}
