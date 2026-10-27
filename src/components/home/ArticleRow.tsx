import Image from "next/image";
import Link from "next/link";
import type { ArticleCardData } from "@/components/ArticleCard";
import { FormatBadge } from "@/components/FormatBadge";
import { Newspaper } from "@/components/icons";
import { PremiumBadge } from "@/components/PremiumBadge";
import { formatDate } from "@/lib/formatDate";

/**
 * Carte d'article « liste encadrée » de la référence Digital Haven : boîte
 * arrondie à 13 px avec ombre douce, image à gauche (arrondie de ce côté),
 * puis rubrique précédée d'une pastille, titre gras et ligne « Par auteur ·
 * date ». Utilisée par les sections À la Une, Analyses et Mercato de l'accueil.
 */
export function ArticleRow({ article }: { article: ArticleCardData }) {
  const href = `/article/${article.slug}`;
  return <article className="group flex min-h-[130px] overflow-hidden rounded-[13px] border border-border bg-card shadow-[0_4px_20px_rgb(0_0_0/7%)] transition-shadow hover:shadow-[0_6px_28px_rgb(0_0_0/12%)]">
    <Link href={href} tabIndex={-1} aria-hidden="true" className="relative block w-[110px] shrink-0 overflow-hidden bg-muted sm:w-[130px]">
      {article.coverImageUrl
        ? <Image src={article.coverImageUrl} alt="" fill sizes="130px" className="object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transform-none" />
        : <span className="flex h-full items-center justify-center text-muted-foreground"><Newspaper size={28} aria-hidden="true" /></span>}
    </Link>
    <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-4 sm:px-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {article.format && <FormatBadge format={article.format} />}
        <span className="inline-flex items-center gap-[7px] text-[11px] font-semibold uppercase tracking-[.5px] text-editorial-link">
          <span aria-hidden="true" className="h-[10px] w-[10px] rounded-full bg-accent" />
          {article.category?.name ?? "Actualité"}
        </span>
        {article.isPremium && <PremiumBadge />}
      </div>
      <h3 className="line-clamp-3 text-[15px] font-heavy leading-snug tracking-[-.4px] text-foreground"><Link href={href} className="hover:underline">{article.title}</Link></h3>
      <p className="mt-2 text-[13px] text-muted-foreground">
        Par <span className="font-semibold text-foreground">{article.author?.name ?? "La rédaction"}</span>
        {article.publishedAt && <> · <time dateTime={article.publishedAt.toISOString()}>{formatDate(article.publishedAt)}</time></>}
      </p>
    </div>
  </article>;
}
