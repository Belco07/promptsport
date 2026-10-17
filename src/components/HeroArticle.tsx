import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Trophy } from "lucide-react";
import type { ArticleCardData } from "@/components/ArticleCard";
import { PremiumBadge } from "@/components/PremiumBadge";
import { formatDate } from "@/lib/formatDate";

export function HeroArticle({ article }: { article: ArticleCardData }) {
  return <article data-home-hero className="animate-fade-up min-w-0 bg-card text-foreground">
    <Link href={`/article/${article.slug}`} className="group block">
      <div className="relative aspect-[16/10] overflow-hidden bg-background">
        {article.coverImageUrl ? <Image src={article.coverImageUrl} alt="" fill priority fetchPriority="high" sizes="(min-width: 1280px) 550px, (min-width: 1024px) 44vw, (min-width: 768px) 63vw, 94vw" quality={75} className="object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none" /> : <div className="flex h-full items-center justify-center"><Trophy size={60} aria-hidden="true" /></div>}
      </div>
      <div className="pt-4">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider"><span className="bg-primary px-2 py-1 text-primary-foreground">À la une</span><span>{article.category?.name ?? "Actualité"}</span>{article.isPremium && <PremiumBadge />}</div>
        <h1 className="mt-3 text-3xl font-black leading-[1.08] tracking-tight group-hover:underline sm:text-4xl">{article.title}</h1>
        {article.excerpt && <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{article.excerpt}</p>}
      </div>
    </Link>
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
      <span>{article.author?.name ?? "La rédaction"} · <time dateTime={article.publishedAt?.toISOString()}>{formatDate(article.publishedAt)}</time></span><ArrowUpRight aria-hidden="true" size={18} />
    </div>
  </article>;
}
