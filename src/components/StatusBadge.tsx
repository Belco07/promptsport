import { Badge, type BadgeTone } from "@/components/ui/Badge";
import {
  ARTICLE_STATUS_LABELS,
  type ArticleStatus,
} from "@/lib/articleStatus";

/**
 * Badge de statut éditorial (refonte WP9) : s'appuie sur le composant Badge.
 *
 * Les teintes reprennent exactement les couleurs d'origine
 * (gris / orange / vert / rouge) pour que la liste des articles du studio, qui
 * l'utilise, garde son apparence.
 */
const STATUS_TONES: Record<ArticleStatus, BadgeTone> = {
  DRAFT: "neutral",
  REVIEW: "accent",
  PUBLISHED: "success",
  ARCHIVED: "danger",
};

export function StatusBadge({ status }: { status: ArticleStatus }) {
  return (
    <Badge variant="status" tone={STATUS_TONES[status]}>
      {ARTICLE_STATUS_LABELS[status]}
    </Badge>
  );
}
