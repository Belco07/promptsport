/**
 * Constantes et helpers du workflow éditorial des articles (WP2f).
 *
 * Les quatre états du cycle : DRAFT → REVIEW → PUBLISHED → ARCHIVED.
 * Seul PUBLISHED est visible publiquement.
 */
export const ARTICLE_STATUSES = [
  "DRAFT",
  "REVIEW",
  "PUBLISHED",
  "ARCHIVED",
] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: "Brouillon",
  REVIEW: "En revue",
  PUBLISHED: "Publié",
  ARCHIVED: "Archivé",
};

/** Classes Tailwind du badge selon le statut. */
export const ARTICLE_STATUS_BADGES: Record<ArticleStatus, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  REVIEW: "bg-orange-100 text-orange-800",
  PUBLISHED: "bg-green-100 text-green-800",
  ARCHIVED: "bg-red-100 text-red-800",
};

/** Vérifie qu'une valeur est un statut valide. */
export function isArticleStatus(value: unknown): value is ArticleStatus {
  return typeof value === "string" && (ARTICLE_STATUSES as readonly string[]).includes(value);
}

/** Seuls les articles PUBLISHED sont visibles publiquement. */
export function isPublicStatus(status: ArticleStatus): boolean {
  return status === "PUBLISHED";
}
