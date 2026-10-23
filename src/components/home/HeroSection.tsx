import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Trophy } from "@/components/icons";
import type { ArticleCardData } from "@/components/ArticleCard";
import { PremiumBadge } from "@/components/PremiumBadge";
import { formatDate } from "@/lib/formatDate";

export function HeroSection({ article, kicker }: { article?: ArticleCardData; kicker?: string }) {
  if (!article) return <section data-home-hero className="order-1 min-w-0 animate-fade-up lg:order-2 lg:col-span-3"><p className="text-sm font-bold uppercase tracking-widest text-editorial-link">Édition du jour</p><h1 className="mt-5 text-4xl font-black tracking-tight text-foreground sm:text-6xl">Le sport a tant à raconter.</h1><p className="mt-5 text-muted-foreground">Les prochaines publications de la rédaction apparaîtront ici.</p></section>;
  const href = `/article/${article.slug}`;
  return <article data-home-hero className="order-1 min-w-0 animate-fade-up lg:order-2 lg:col-span-3">
    <Link href={href} aria-hidden="true" tabIndex={-1} className="relative block aspect-video overflow-hidden bg-muted">
      {article.coverImageUrl ? <Image src={article.coverImageUrl} alt="" fill priority fetchPriority="high" quality={75} sizes="(min-width: 1280px) 920px, (min-width: 1024px) 72vw, 100vw" className="object-cover" /> : <span className="flex h-full items-center justify-center text-muted-foreground"><Trophy aria-hidden="true" size={64} /></span>}
    </Link>
    <div className="pt-5 sm:pt-6">
      <div className="flex flex-wrap items-center gap-3"><span className="bg-accent px-2 py-1 text-xs font-black uppercase tracking-widest text-foreground dark:text-background">{kicker ?? article.category?.name ?? "À la Une"}</span>{article.isPremium && <PremiumBadge />}</div>
      <h1 className="mt-4 text-4xl font-black leading-[1.04] tracking-tight text-foreground sm:text-5xl xl:text-6xl"><Link href={href} className="decoration-2 underline-offset-4 hover:underline">{article.title}</Link></h1>
      {article.excerpt && <p className="mt-4 line-clamp-3 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">{article.excerpt}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground"><p>{article.author?.name ?? "La rédaction"}{article.publishedAt && <> · <time dateTime={article.publishedAt.toISOString()}>{formatDate(article.publishedAt)}</time></>}</p><Link href={href} aria-label={`Lire le récit : ${article.title}`} className="inline-flex min-h-11 items-center gap-2 font-bold text-editorial-link">Lire le récit <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
    </div>
  </article>;
}
