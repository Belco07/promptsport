import { BookmarkButton } from "@/components/BookmarkButton";
import { FormatBadge, type ArticleFormat } from "@/components/FormatBadge";
import { Newspaper } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";

import { PremiumBadge } from "@/components/PremiumBadge";
import { Card, CardBody } from "@/components/ui/Card";
import { formatDate } from "@/lib/formatDate";

export type ArticleCardData = {
  format?: ArticleFormat;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  publishedAt: Date | null;
  isPremium: boolean;
  category: { name: string } | null;
  author: { name: string; slug?: string | null } | null;
};

/**
 * Carte d'article (refonte WP9).
 * Utilisée dans une grille responsive (1/2/3 colonnes gérée par le parent).
 *
 * `priority` est réservé à la première carte : c'est l'image LCP de l'accueil,
 * elle doit être chargée sans attendre (les suivantes restent en lazy loading).
 */
export function ArticleCard({
  article,
  priority = false,
  /** Variante éditoriale : la une affiche une image et un titre plus grands. */
  featured = false,
  headingLevel = 2,
  bookmark,
}: {
  article: ArticleCardData;
  priority?: boolean;
  featured?: boolean;
  headingLevel?: 2 | 3;
  bookmark?: { articleId: string; saved: boolean; showLabel?: boolean };
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const href = `/article/${article.slug}`;
  const authorHref = article.author?.slug ? `/auteur/${article.author.slug}` : null;

  return (
    <Card
      as="article"
      interactive
      className="editorial-card animate-fade-up flex flex-col overflow-hidden border border-border bg-card transition-shadow duration-200"
    >
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block aspect-video w-full overflow-hidden bg-muted"
      >
        {article.coverImageUrl ? (
          <Image
            src={article.coverImageUrl}
            alt=""
            fill
            priority={priority}
            // `priority` déclenche le préchargement ; l'attribut explicite
            // couvre les navigateurs qui l'ignorent.
            fetchPriority={priority ? "high" : "auto"}
            // Largeurs réelles de la grille (1 / 2 colonnes dans la colonne de
            // contenu, 1152 px au plus) : la variante 360 px suffit pour les
            // vignettes de ~380 px et évite de charger du 384 px inutilement.
            sizes="(max-width: 640px) 92vw, (max-width: 1024px) 48vw, 356px"
            // Qualité 70 : en AVIF, l'écart visuel avec 75 est imperceptible sur
            // une vignette, pour environ 15 % d'octets en moins (WP9).
            quality={70}
            className="object-cover transition-transform duration-300 hover:scale-[1.03] motion-reduce:transition-none motion-reduce:hover:scale-100"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
            <Newspaper aria-hidden="true" size={40} />
          </div>
        )}
      </Link>

      <CardBody className="flex flex-1 flex-col bg-muted p-5">
        {article.format || article.category || article.isPremium ? (
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {article.format && <FormatBadge format={article.format} />}
            {/* Rubrique précédée d'une pastille ronde, comme la référence (couleurs du site). */}
            {article.category ? (
              <span className="inline-flex items-center gap-[7px] text-[11px] font-semibold uppercase tracking-[.5px] text-editorial-link">
                <span aria-hidden="true" className="h-[10px] w-[10px] rounded-full bg-accent" />
                {article.category.name}
              </span>
            ) : null}
            {article.isPremium ? <PremiumBadge /> : null}
          </div>
        ) : null}

        <Heading
          className={`mb-2 font-heavy leading-tight text-foreground ${
            featured ? "text-2xl" : "text-[17px] leading-[1.3] tracking-[-.4px]"
          }`}
        >
          <Link href={href} className="transition-colors hover:text-editorial-link">
            {article.title}
          </Link>
        </Heading>

        {article.excerpt ? (
          <p className="mb-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {article.excerpt}
          </p>
        ) : null}

        {/* Ligne « Par auteur · date », sans filet, comme la référence. */}
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[13px] text-muted-foreground">
          <span>Par</span>
          <span className="font-semibold text-foreground">
            {authorHref ? (
              <Link href={authorHref} className="transition-colors hover:text-editorial-link">
                {article.author?.name}
              </Link>
            ) : (
              (article.author?.name ?? "Rédaction")
            )}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="inline-flex items-center gap-1">
            <time dateTime={article.publishedAt?.toISOString()}>
              {formatDate(article.publishedAt)}
            </time>
          </span>
          <span className="ml-auto"><BookmarkButton articleSlug={article.slug} initial={bookmark ? { id: bookmark.articleId, slug: article.slug, saved: bookmark.saved } : undefined} showLabel={bookmark?.showLabel} /></span>
        </div>
      </CardBody>
    </Card>
  );
}
