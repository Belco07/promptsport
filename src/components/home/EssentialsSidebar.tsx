import Link from "next/link";
import type { ArticleCardData } from "@/components/ArticleCard";

export function EssentialsSidebar({ essentials, wire }: { essentials: ArticleCardData[]; wire: ArticleCardData[] }) {
  return <aside aria-label="L’essentiel et le fil info" data-home-wire className="order-3 min-w-0 space-y-8 animate-fade-up stagger-1 lg:col-start-4 lg:row-span-2 lg:border-l lg:border-border lg:pl-6">
    <section aria-labelledby="essentiel-title" className="border-t-4 border-foreground bg-muted p-5 pt-4">
      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-widest text-editorial-link">Pour ne rien manquer</p><h2 id="essentiel-title" className="text-2xl font-black tracking-tight text-foreground">L’essentiel</h2>
      <ol className="mt-5 divide-y divide-border">{essentials.slice(0, 3).map((article, index) => <li key={article.slug} className="flex gap-3 py-4 first:pt-0"><span aria-hidden="true" className="pt-0.5 text-xs font-black tabular-nums text-editorial-link">0{index + 1}</span><h3 className="text-sm font-bold leading-snug text-foreground"><Link href={`/article/${article.slug}`} className="underline-offset-4 hover:underline">{article.title}</Link></h3></li>)}</ol>
      {!essentials.length && <p className="mt-4 text-sm text-muted-foreground">Les infos à retenir arrivent bientôt.</p>}
    </section>
    <section aria-labelledby="fil-info" className="border-t-4 border-foreground pt-4"><div className="flex items-center gap-2"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-editorial-link" /><h2 id="fil-info" className="text-2xl font-black tracking-tight text-foreground">Le Fil Info</h2></div>
      <ol aria-label="Dernières brèves" className="mt-5 divide-y divide-border">{wire.slice(0, 5).map(article => <li key={article.slug} className="py-4 first:pt-0">{article.publishedAt && <time dateTime={article.publishedAt.toISOString()} className="text-[11px] font-bold tabular-nums text-editorial-link">{article.publishedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Africa/Lagos" })} · {article.publishedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}</time>}<h3 className="mt-2 text-sm font-semibold leading-snug text-foreground"><Link href={`/article/${article.slug}`} className="underline-offset-4 hover:underline">{article.title}</Link></h3></li>)}</ol>
      {!wire.length && <p className="mt-4 text-sm text-muted-foreground">Aucune brève publiée pour le moment.</p>}
      <Link href="#derniers-articles" className="mt-3 inline-flex min-h-11 items-center text-xs font-bold text-editorial-link hover:underline">Toutes les dernières infos →</Link>
    </section>
  </aside>;
}
