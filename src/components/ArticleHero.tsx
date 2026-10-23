import Link from "next/link";
import type { ReactNode } from "react";
import { PremiumBadge } from "@/components/PremiumBadge";

/**
 * En-tête d'article sur toute la largeur, comme la référence « Digital Haven » :
 * catégorie précédée d'une pastille, grand titre, puis accroche. L'image de
 * couverture n'est plus sous le titre en surimpression : elle suit la ligne
 * d'auteur, dans la colonne de lecture.
 *
 * `badges` (format) et `actions` (enregistrement) sont fournis par la page.
 */
export function ArticleHero({
  title,
  excerpt,
  premium,
  category,
  badges,
  actions,
}: {
  title: string;
  excerpt: string | null;
  premium: boolean;
  category: { name: string; slug: string } | null;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {category && (
            <Link
              href={`/archives?category=${encodeURIComponent(category.slug)}`}
              className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[1px] text-foreground hover:text-editorial-link"
            >
              <span aria-hidden="true" className="h-[9px] w-[9px] rounded-full bg-accent" />
              {category.name}
            </Link>
          )}
          {badges}
          {premium && <PremiumBadge />}
        </div>
        {actions}
      </div>
      <h1 className="mt-4 text-3xl font-black leading-[1.15] tracking-tight sm:text-4xl lg:text-[50px] lg:leading-[1.2]">{title}</h1>
      {excerpt && <p className="mt-5 max-w-[1000px] text-[17px] font-medium leading-relaxed text-muted-foreground">{excerpt}</p>}
    </header>
  );
}
