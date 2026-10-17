import Image from "next/image";
import Link from "next/link";
import type { ArticleCardData } from "@/components/ArticleCard";
import { PremiumBadge } from "@/components/PremiumBadge";

export function ArticleRow({ article, image = false }: { article: ArticleCardData; image?: boolean }) {
  return <article className="group py-5 first:pt-0">
    {image && article.coverImageUrl && <Link href={`/article/${article.slug}`} tabIndex={-1} aria-hidden="true" className="relative mb-4 block aspect-video overflow-hidden bg-muted"><Image src={article.coverImageUrl} alt="" fill sizes="(min-width: 1024px) 280px, (min-width: 768px) 45vw, 94vw" className="object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transform-none" /></Link>}
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-editorial-link"><span>{article.category?.name ?? "Actualité"}</span>{article.isPremium && <PremiumBadge />}</div>
    <h3 className="text-xl font-heavy leading-tight tracking-tight text-foreground"><Link href={`/article/${article.slug}`} className="underline-offset-4 hover:underline">{article.title}</Link></h3>
    {article.excerpt && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{article.excerpt}</p>}
    {article.publishedAt && <time dateTime={article.publishedAt.toISOString()} className="mt-3 block text-xs text-muted-foreground">{article.publishedAt.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}</time>}
  </article>;
}
