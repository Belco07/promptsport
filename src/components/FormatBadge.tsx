export type ArticleFormat = "FLASH" | "NEWS" | "ANALYSIS";

const labels: Record<ArticleFormat, string> = {
  FLASH: "FLASH", NEWS: "ACTU", ANALYSIS: "ANALYSE",
};

export function FormatBadge({ format }: { format: ArticleFormat }) {
  return <span data-article-format={format} className={`format-badge format-badge--${format.toLowerCase()}`}>{labels[format]}</span>;
}
