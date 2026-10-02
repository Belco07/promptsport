/**
 * Constantes et helpers de l'engagement (WP10a) : commentaires, réactions et
 * signalements.
 *
 * Ce module ne contient que des libellés, des garde-fous de type et des
 * helpers d'affichage : la logique métier (publication, modération,
 * notifications) relève des WP10b à WP10d.
 */

/** Longueur maximale d'un commentaire, contrôlée côté application. */
export const COMMENT_MAX_LENGTH = 5000;

/** Longueur de l'extrait affiché dans les tableaux d'administration (WP10c). */
export const COMMENT_EXCERPT_LENGTH = 150;

/* ------------------------------------------------------------- commentaires */

export const COMMENT_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FLAGGED",
  "DELETED",
] as const;

export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const COMMENT_STATUS_LABELS: Record<CommentStatus, string> = {
  PENDING: "En attente",
  APPROVED: "Approuvé",
  REJECTED: "Rejeté",
  FLAGGED: "Signalé",
  DELETED: "Supprimé",
};

/** Classes Tailwind du badge de statut (mêmes teintes que les articles). */
export const COMMENT_STATUS_BADGES: Record<CommentStatus, string> = {
  PENDING: "bg-gray-100 text-gray-600",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-orange-100 text-orange-800",
  FLAGGED: "bg-red-100 text-red-800",
  DELETED: "bg-gray-200 text-gray-500",
};

/** Vérifie qu'une valeur est un statut de commentaire valide. */
export function isCommentStatus(value: unknown): value is CommentStatus {
  return typeof value === "string" && (COMMENT_STATUSES as readonly string[]).includes(value);
}

/** Un commentaire supprimé n'est plus affiché publiquement. */
export function isVisibleComment(status: CommentStatus): boolean {
  return status === "APPROVED";
}

/* --------------------------------------------------------------- réactions */

export const REACTION_TYPES = ["LIKE", "DISLIKE", "LOVE", "LAUGH", "BOOKMARK"] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_LABELS: Record<ReactionType, string> = {
  LIKE: "J'aime",
  DISLIKE: "Je n'aime pas",
  LOVE: "J'adore",
  LAUGH: "Drôle",
  BOOKMARK: "Enregistré",
};

/** Réactions proposées sur un commentaire (voir le brief WP10a). */
export const COMMENT_REACTION_TYPES: ReactionType[] = ["LIKE", "DISLIKE", "LOVE", "LAUGH"];

/** Réactions proposées sur un article. */
export const ARTICLE_REACTION_TYPES: ReactionType[] = ["LIKE", "LOVE", "BOOKMARK"];

export function isReactionType(value: unknown): value is ReactionType {
  return typeof value === "string" && (REACTION_TYPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ signalements */

export const REPORT_REASONS = [
  "SPAM",
  "HARASSMENT",
  "HATE_SPEECH",
  "MISINFORMATION",
  "OTHER",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: "Spam",
  HARASSMENT: "Harcèlement",
  HATE_SPEECH: "Discours haineux",
  MISINFORMATION: "Désinformation",
  OTHER: "Autre",
};

export const REPORT_STATUSES = ["PENDING", "REVIEWED", "RESOLVED", "DISMISSED"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  PENDING: "À traiter",
  REVIEWED: "En cours",
  RESOLVED: "Résolu",
  DISMISSED: "Rejeté",
};

export const REPORT_STATUS_BADGES: Record<ReportStatus, string> = {
  PENDING: "bg-red-100 text-red-800",
  REVIEWED: "bg-orange-100 text-orange-800",
  RESOLVED: "bg-green-100 text-green-800",
  DISMISSED: "bg-gray-100 text-gray-600",
};

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === "string" && (REPORT_REASONS as readonly string[]).includes(value);
}

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && (REPORT_STATUSES as readonly string[]).includes(value);
}

/* ------------------------------------------------ engagement public (WP10b) */

/** Nombre de commentaires affichés par page sur la page article. */
export const COMMENTS_PAGE_SIZE = 20;

/** Réactions proposées publiquement sur un commentaire (brief WP10b). */
export const PUBLIC_COMMENT_REACTIONS: ReactionType[] = ["LIKE", "LOVE", "LAUGH"];

/** Émoji associé à chaque réaction, pour les boutons publics. */
export const REACTION_EMOJI: Record<ReactionType, string> = {
  LIKE: "👍",
  DISLIKE: "👎",
  LOVE: "❤️",
  LAUGH: "😂",
  BOOKMARK: "🔖",
};

/** Réactions dont le compteur est public (Bookmark reste privé). */
export const PUBLIC_REACTION_COUNTERS: ReactionType[] = ["LIKE", "LOVE"];

export const COMMENT_SORTS = ["recent", "oldest", "liked"] as const;
export type CommentSort = (typeof COMMENT_SORTS)[number];

export const COMMENT_SORT_LABELS: Record<CommentSort, string> = {
  recent: "Plus récents",
  oldest: "Plus anciens",
  liked: "Plus likés",
};

/** Tri par défaut : le plus récent d'abord. */
export const DEFAULT_COMMENT_SORT: CommentSort = "recent";

export function isCommentSort(value: unknown): value is CommentSort {
  return typeof value === "string" && (COMMENT_SORTS as readonly string[]).includes(value);
}

/** Normalise le paramètre d'URL `commentsSort`. */
export function resolveCommentSort(value: string | undefined): CommentSort {
  return isCommentSort(value) ? value : DEFAULT_COMMENT_SORT;
}

/**
 * Ordre de lecture à appliquer côté requête. « liked » se trie sur le nombre de
 * réactions : la page traduit ce descripteur en `orderBy` Prisma.
 */
export function commentsOrder(
  sort: CommentSort,
): { field: "createdAt"; direction: "asc" | "desc" } | { byReactions: "desc" } {
  if (sort === "oldest") return { field: "createdAt", direction: "asc" };
  if (sort === "liked") return { byReactions: "desc" };
  return { field: "createdAt", direction: "desc" };
}

/** Normalise le paramètre d'URL `commentsPage` (1 minimum). */
export function resolveCommentsPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Le tri « plus likés » a besoin du nombre de réactions par commentaire. */
export function commentSortNeedsCounts(sort: CommentSort): boolean {
  return sort === "liked";
}

/** Compteurs de réactions affichés par les composants publics. */
export type ReactionCounts = Partial<Record<ReactionType, number>>;

/** État renvoyé par les Server Actions de réaction (UI optimiste). */
export type ReactionState = {
  counts: ReactionCounts;
  /** Réaction de l'utilisateur courant, `null` s'il n'en a aucune. */
  mine: ReactionType | null;
};

export type EngagementResult =
  | { ok: true; state?: ReactionState }
  | { ok: false; error: string };

/* ----------------------------------------------------------------- helpers */

/**
 * Extrait d'un commentaire pour les tableaux d'administration : espaces
 * normalisés (un commentaire multiligne ne doit pas casser la ligne du tableau)
 * puis troncature avec ellipsis.
 */
export function commentExcerpt(
  content: string,
  max: number = COMMENT_EXCERPT_LENGTH,
): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Vrai si le texte respecte la limite de longueur d'un commentaire. */
export function isValidCommentLength(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= COMMENT_MAX_LENGTH;
}

/* ------------------------------------------------------- modération (WP10c) */

/**
 * Statuts qu'un modérateur peut appliquer directement depuis la liste.
 * DELETED est une suppression douce : le contenu reste en base pour l'audit.
 */
export const MODERATION_STATUSES: CommentStatus[] = ["APPROVED", "REJECTED", "DELETED"];

/** Vrai si le commentaire est visible publiquement. */
export function isPublicComment(status: CommentStatus): boolean {
  return status === "APPROVED";
}

/* ---------------------------------------------------- bannissement (WP10c) */

export const BAN_DURATIONS = [
  { value: "1d", label: "1 jour", days: 1 },
  { value: "7d", label: "7 jours", days: 7 },
  { value: "30d", label: "30 jours", days: 30 },
  { value: "permanent", label: "Permanent", days: null },
] as const;

export type BanDuration = (typeof BAN_DURATIONS)[number]["value"];

/**
 * Date de fin d'un bannissement permanent. Utiliser une date très lointaine
 * évite un second champ booléen qui pourrait contredire `bannedUntil`.
 */
export const PERMANENT_BAN_UNTIL = new Date("9999-12-31T23:59:59.000Z");

export function isBanDuration(value: unknown): value is BanDuration {
  return BAN_DURATIONS.some((duration) => duration.value === value);
}

/** Date de fin correspondant à une durée choisie dans le formulaire. */
export function banUntilFromDuration(duration: BanDuration, from: Date = new Date()): Date {
  const entry = BAN_DURATIONS.find((item) => item.value === duration);
  if (!entry || entry.days === null) {
    return PERMANENT_BAN_UNTIL;
  }
  const until = new Date(from);
  until.setUTCDate(until.getUTCDate() + entry.days);
  return until;
}

/** Vrai si l'auteur est actuellement banni (date de fin dans le futur). */
export function isBanned(
  author: { bannedUntil: Date | null },
  now: Date = new Date(),
): boolean {
  return Boolean(author.bannedUntil && author.bannedUntil.getTime() > now.getTime());
}

/** Vrai si l'auteur a été banni mais que le bannissement est terminé. */
export function wasBanned(author: { bannedUntil: Date | null }): boolean {
  return Boolean(author.bannedUntil) && !isBanned(author);
}

/** Libellé du statut de bannissement, pour la colonne d'administration. */
export function banStatusLabel(
  author: { bannedUntil: Date | null },
  now: Date = new Date(),
): string {
  if (isBanned(author, now)) {
    return author.bannedUntil?.getUTCFullYear() === PERMANENT_BAN_UNTIL.getUTCFullYear()
      ? "Banni définitivement"
      : "Banni temporairement";
  }
  if (wasBanned(author)) {
    return "Bannissement terminé";
  }
  return "Non banni";
}

/**
 * Message affiché à un utilisateur banni qui tente de commenter.
 * `formatDate` reste hors de ce module (aucune dépendance de présentation ici) :
 * la date lisible est passée par l'appelant.
 */
export function bannedCommentMessage(reason: string | null, untilLabel: string): string {
  return `Vous êtes temporairement banni jusqu'au ${untilLabel}. Raison : ${
    reason?.trim() || "non précisée"
  }`;
}
