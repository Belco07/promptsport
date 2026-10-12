import Link from "next/link";

/**
 * Bandeau urgent : fine barre affichée **au-dessus de l'en-tête** sur toutes les
 * pages publiques.
 *
 * L'article vient de `getUrgentArticle()` (src/lib/featured.ts) : choix manuel
 * dans le studio (`/studio/une`), sinon automatiquement le dernier FLASH ou NEWS
 * publié. Le point animé attire l'œil sans masquer l'information ; l'animation
 * est neutralisée pour qui préfère limiter les mouvements
 * (`prefers-reduced-motion`, géré en CSS).
 */
export function UrgentBanner({
  article,
}: {
  article: { slug: string; title: string };
}) {
  return (
    <aside aria-label="Information urgente" className="urgent-bar">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 py-1.5">
        <span className="urgent-label">
          <span className="urgent-pulse" aria-hidden="true" />
          <span>Urgent</span>
        </span>
        <Link
          href={`/article/${article.slug}`}
          className="urgent-title min-w-0 truncate text-[13px] font-bold"
        >
          {article.title}
        </Link>
      </div>
    </aside>
  );
}
