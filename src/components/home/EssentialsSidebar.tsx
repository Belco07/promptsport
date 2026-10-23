import Link from "next/link";
import { TimelineBadge } from "@/components/TimelineBadge";
import type { ArticleCardData } from "@/components/ArticleCard";
import { SectionHeading } from "@/components/SectionHeading";

/**
 * « Le Fil Info », dans la rangée de l'article à la une : il reste fixé
 * (sticky) pendant le défilement jusqu'à ce que l'article à la une soit
 * entièrement passé (le bloc ne dépasse pas sa rangée de grille).
 */
export function WireAside({ wire }: { wire: ArticleCardData[] }) {
  return <aside aria-label="Le fil info" data-home-wire className="order-3 min-w-0 animate-fade-up stagger-1 lg:col-start-4 lg:row-start-2 lg:border-l lg:border-border lg:pl-6">
    <section aria-labelledby="fil-info" className="lg:sticky lg:top-[120px]">
      <SectionHeading id="fil-info" title="Le Fil Info" />
      <ol aria-label="Dernières brèves" className="ml-1 mt-5 border-l border-border">{wire.slice(0, 5).map(article => <li key={article.slug} className="relative min-w-0 pb-6 pl-4 last:pb-0"><span aria-hidden="true" className="absolute -left-1 top-1.5 h-2 w-2 rounded-full border border-border bg-background" /><div className="flex flex-wrap items-center gap-2">{article.publishedAt && <time dateTime={article.publishedAt.toISOString()} title={article.publishedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Lagos" })} className="text-[11px] tabular-nums text-muted-foreground">{article.publishedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</time>}<TimelineBadge category={article.category} /></div><h3 className="mt-2 text-sm font-semibold leading-snug text-foreground"><Link href={`/article/${article.slug}`} className="underline-offset-4 hover:underline">{article.title}</Link></h3></li>)}</ol>
      {!wire.length && <p className="mt-4 text-sm text-muted-foreground">Aucune brève publiée pour le moment.</p>}
      <Link href="#derniers-articles" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-editorial-link hover:underline">Toutes les dernières infos →</Link>
    </section>
  </aside>;
}

/**
 * « L'essentiel », colonne latérale des sections Thèmes / À la Une / Analyses /
 * Mercato ; reste fixé pendant leur lecture. Encadré arrondi.
 */
export function EssentialsAside({ essentials }: { essentials: ArticleCardData[] }) {
  return <aside aria-label="L’essentiel" className="min-w-0 animate-fade-up stagger-2 lg:border-l lg:border-border lg:pl-6">
    <section aria-labelledby="essentiel-title" className="rounded-[18px] bg-muted p-5 lg:sticky lg:top-[120px]">
      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-editorial-link">Pour ne rien manquer</p>
      <SectionHeading id="essentiel-title" title="L’essentiel" />
      <ol className="divide-y divide-border">{essentials.slice(0, 3).map((article, index) => <li key={article.slug} className="flex gap-3 py-4 first:pt-0"><span aria-hidden="true" className="pt-0.5 text-xs font-black tabular-nums text-editorial-link">0{index + 1}</span><h3 className="text-sm font-bold leading-snug text-foreground"><Link href={`/article/${article.slug}`} className="underline-offset-4 hover:underline">{article.title}</Link></h3></li>)}</ol>
      {!essentials.length && <p className="mt-4 text-sm text-muted-foreground">Les infos à retenir arrivent bientôt.</p>}
    </section>
  </aside>;
}
