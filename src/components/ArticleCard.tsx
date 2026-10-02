import { Clock } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { PremiumBadge } from "@/components/PremiumBadge";
import { Card, CardBody } from "@/components/ui/Card";
import { formatDate } from "@/lib/formatDate";

export type ArticleCardData = {
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
}: {
  article: ArticleCardData;
  priority?: boolean;
  featured?: boolean;
}) {
  const href = `/article/${article.slug}`;
  const authorHref = article.author?.slug ? `/auteur/${article.author.slug}` : null;

  return (
    <Card
      as="article"
      interactive
      className="flex flex-col overflow-hidden rounded-none border-x-0 border-t-0 border-b border-b-ink-200 shadow-none hover:shadow-none"
    >
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block aspect-video w-full overflow-hidden bg-neutral-100"
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
          <div className="flex h-full w-full items-center justify-center bg-neutral-100 text-4xl text-neutral-300">
            ⚽
          </div>
        )}
      </Link>

      <CardBody className="flex flex-1 flex-col bg-neutral-50 p-0 py-[17px]">
        {article.category || article.isPremium ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {/* Rubrique : libellé éditorial rouge, sans pastille (identité « news »). */}
            {article.category ? (
              <span className="text-[10px] font-extrabold uppercase tracking-[.6px] text-brand-600">
                {article.category.name}
              </span>
            ) : null}
            {article.isPremium ? <PremiumBadge /> : null}
          </div>
        ) : null}

        <h2
          className={`mb-2 font-heavy leading-tight text-ink-950 ${
            featured ? "text-2xl" : "text-xl tracking-[-.6px]"
          }`}
        >
          <Link href={href} className="transition-colors hover:text-brand-600">
            {article.title}
          </Link>
        </h2>

        {article.excerpt ? (
          <p className="mb-4 line-clamp-3 text-sm leading-6 text-neutral-600">
            {article.excerpt}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
          <span className="font-semibold text-neutral-700">
            {authorHref ? (
              <Link href={authorHref} className="transition-colors hover:text-brand-600">
                {article.author?.name}
              </Link>
            ) : (
              (article.author?.name ?? "Rédaction")
            )}
          </span>
          <span aria-hidden="true" className="text-neutral-300">
            •
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden="true" className="h-3.5 w-3.5" />
            <time dateTime={article.publishedAt?.toISOString()}>
              {formatDate(article.publishedAt)}
            </time>
          </span>
        </div>
      </CardBody>
    </Card>
  );
}

