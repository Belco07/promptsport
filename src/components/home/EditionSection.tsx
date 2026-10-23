import type { ArticleCardData } from "@/components/ArticleCard";
import { SectionHeading } from "@/components/SectionHeading";
import { ArticleRow } from "./ArticleRow";

/**
 * Section éditoriale de l'accueil (À la Une, Analyses, Mercato), disposée comme
 * les blocs de la référence : titre commun, puis cartes « liste encadrée » sur
 * deux colonnes.
 */
export function EditionSection({ id, title, articles, href }: { id: "une" | "analyses" | "mercato"; title: string; articles: ArticleCardData[]; href: string }) {
  return <section id={id} aria-labelledby={`${id}-title`} data-edition-section={id} className="min-w-0 animate-fade-up">
    <SectionHeading id={`${id}-title`} title={title} href={href} />
    {articles.length
      ? <div className="grid gap-4 md:grid-cols-2">{articles.map(article => <ArticleRow key={article.slug} article={article} />)}</div>
      : <p className="py-4 text-sm leading-relaxed text-muted-foreground">Les prochaines publications apparaîtront ici.</p>}
  </section>;
}
