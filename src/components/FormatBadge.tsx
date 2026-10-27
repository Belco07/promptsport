import { Lightning, Strategy } from "@phosphor-icons/react/ssr";

export type ArticleFormat = "FLASH" | "NEWS" | "ANALYSIS";

/**
 * Badge de format d'article, pour reconnaître un format d'un coup d'œil :
 * FLASH en rouge (le rouge du bandeau « Urgent ») avec un éclair, ANALYSE en
 * vert citron (l'accent du site). L'actualité (NEWS) est le format par défaut :
 * elle n'a pas de badge, ce qui fait ressortir les deux autres.
 *
 * Styles : `.format-badge` dans src/app/globals.css.
 */
const badges: Partial<Record<ArticleFormat, { label: string; Icon: typeof Lightning }>> = {
  FLASH: { label: "Flash", Icon: Lightning },
  ANALYSIS: { label: "Analyse", Icon: Strategy },
};

export function FormatBadge({ format }: { format: ArticleFormat }) {
  const badge = badges[format];
  if (!badge) return null;
  const { label, Icon } = badge;
  return (
    <span data-article-format={format} className={`format-badge format-badge--${format.toLowerCase()}`}>
      <Icon aria-hidden="true" size={12} weight="fill" />
      {label}
    </span>
  );
}
