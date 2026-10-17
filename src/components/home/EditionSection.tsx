import Link from "next/link";
import type { ArticleCardData } from "@/components/ArticleCard";
import { ArticleRow } from "./ArticleRow";

const placement = {
  une: "order-6 stagger-4 lg:order-4 lg:col-start-1",
  analyses: "order-4 stagger-2 lg:order-5 lg:col-start-2",
  mercato: "order-5 stagger-3 lg:order-6 lg:col-start-3",
};
export function EditionSection({ id, title, articles, href }: { id: keyof typeof placement; title: string; articles: ArticleCardData[]; href: string }) {
  return <section id={id} aria-labelledby={`${id}-title`} data-edition-section={id} className={`min-w-0 animate-fade-up border-t-4 border-foreground pt-4 ${placement[id]}`}>
    <div className="mb-6 flex items-baseline justify-between gap-3"><h2 id={`${id}-title`} className="text-2xl font-black tracking-tight text-foreground">{title}</h2><span aria-hidden="true" className="text-xs font-bold tabular-nums text-muted-foreground">0{articles.length}</span></div>
    {articles.length ? <div className="divide-y divide-border">{articles.map((article, index) => <ArticleRow key={article.slug} article={article} image={index === 0} />)}</div> : <p className="py-4 text-sm leading-relaxed text-muted-foreground">Les prochaines publications apparaîtront ici.</p>}
    <Link href={href} className="mt-3 inline-flex min-h-11 items-center text-xs font-bold uppercase tracking-wide text-editorial-link underline-offset-4 hover:underline">Tout voir <span aria-hidden="true" className="ml-2">→</span><span className="sr-only"> · {title}</span></Link>
  </section>;
}
