/**
 * Constantes et helpers des rôles utilisateurs (WP5).
 *
 * Trois rôles fixes :
 *  - ADMIN      : accès /studio et /backoffice, gestion des utilisateurs.
 *  - EDITOR     : accès /studio, peut publier et archiver.
 *  - JOURNALIST : accès /studio, ne peut pas publier.
 */
import type { ArticleStatus } from "./articleStatus";

export const USER_ROLES = ["ADMIN", "EDITOR", "JOURNALIST"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrateur",
  EDITOR: "Éditeur",
  JOURNALIST: "Journaliste",
};

/** Classes Tailwind du badge selon le rôle (rouge/bleu/gris). */
export const USER_ROLE_BADGES: Record<UserRole, string> = {
  ADMIN: "bg-red-100 text-red-800",
  EDITOR: "bg-blue-100 text-blue-800",
  JOURNALIST: "bg-gray-100 text-gray-600",
};

/** Vérifie qu'une valeur est un rôle valide. */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

/** Un utilisateur peut-il publier/archiver des articles ? */
export function canPublish(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "EDITOR";
}

/**
 * Un utilisateur peut-il décider qu'un article est **réservé aux abonnés** ?
 *
 * Le drapeau `isPremium` a le même effet qu'une publication : il ferme la
 * lecture au-delà de l'extrait. C'est donc un arbitrage éditorial et commercial,
 * réservé aux rôles qui publient — un journaliste peut écrire pour les abonnés,
 * mais ne décide pas de le faire. La fonction est distincte de `canPublish`,
 * même si les deux coïncident aujourd'hui : ce sont deux décisions différentes,
 * et rien n'oblige à les faire évoluer ensemble.
 */
export function canSetPremium(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "EDITOR";
}

/** Un utilisateur a-t-il accès au backoffice ? */
export function canAccessBackoffice(role: UserRole | undefined | null): boolean {
  return role === "ADMIN";
}

/** Un utilisateur a-t-il accès au studio ? */
export function canAccessStudio(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "EDITOR" || role === "JOURNALIST";
}

/* -------------------------------------------------------------------------- */
/* Droits sur un article (WP11)                                               */
/* -------------------------------------------------------------------------- */

/**
 * Règles éditoriales sur un article :
 *
 *  - la rédaction voit tous les articles (le studio est un espace partagé) ;
 *  - un JOURNALIST n'agit que sur **ses** articles, et seulement tant qu'ils ne
 *    sont pas publiés : une fois publié, l'article sort de son périmètre ;
 *  - le passage en brouillon est réservé à l'auteur : un éditeur qui renvoie un
 *    article arrière le met « en revue », charge à l'auteur d'en faire un
 *    brouillon ;
 *  - seuls ADMIN et EDITOR publient, archivent ou dépublient ;
 *  - le caractère **premium** (réservé aux abonnés) suit la même règle : il est
 *    décidé par un ADMIN ou un EDITOR, au moment de publier. Un journaliste qui
 *    enregistre son brouillon ne peut ni l'activer ni l'effacer — la valeur en
 *    base est conservée (`canSetPremium`) ;
 *  - la suppression d'un article publié ou archivé est réservée à l'ADMIN.
 */

export type ArticleViewer = {
  id: string;
  role: UserRole | undefined | null;
};

export type ArticleSubject = {
  authorId: string;
  status: ArticleStatus;
};

/** Rôles qui pilotent le cycle de vie éditorial. */
function isPrivileged(role: UserRole | undefined | null): boolean {
  return role === "ADMIN" || role === "EDITOR";
}

/** Un article publié ou archivé n'est plus modifiable par son auteur. */
function isOutOfAuthorHands(status: ArticleStatus): boolean {
  return status === "PUBLISHED" || status === "ARCHIVED";
}

/** L'auteur de l'article ? */
function isAuthor(viewer: ArticleViewer, article: ArticleSubject): boolean {
  return viewer.id === article.authorId;
}

/** Modifier le contenu d'un article (titre, texte, rubrique, couverture…). */
export function canEditArticle(viewer: ArticleViewer, article: ArticleSubject): boolean {
  if (isPrivileged(viewer.role)) {
    return true;
  }
  return viewer.role === "JOURNALIST" && isAuthor(viewer, article) && !isOutOfAuthorHands(article.status);
}

/** Supprimer un article. */
export function canDeleteArticle(viewer: ArticleViewer, article: ArticleSubject): boolean {
  if (viewer.role === "ADMIN") {
    return true;
  }
  if (isOutOfAuthorHands(article.status)) {
    return false;
  }
  if (viewer.role === "EDITOR") {
    return true;
  }
  return viewer.role === "JOURNALIST" && isAuthor(viewer, article);
}

/** Faire évoluer le statut d'un article vers `to`. */
export function canTransitionArticle(
  viewer: ArticleViewer,
  article: ArticleSubject,
  to: ArticleStatus,
): boolean {
  // Le brouillon reste l'état de travail de l'auteur, quel que soit le rôle.
  if (to === "DRAFT" && !isAuthor(viewer, article)) {
    return false;
  }

  if (isPrivileged(viewer.role)) {
    return true;
  }

  if (viewer.role !== "JOURNALIST" || !isAuthor(viewer, article)) {
    return false;
  }
  if (isOutOfAuthorHands(article.status)) {
    return false;
  }
  // L'auteur circule entre brouillon et relecture ; il ne publie pas.
  return to === "DRAFT" || to === "REVIEW";
}

/**
 * Statuts proposés dans le sélecteur : uniquement ceux que l'utilisateur peut
 * réellement atteindre depuis l'état courant.
 */
export function allowedArticleStatuses(
  viewer: ArticleViewer,
  article: ArticleSubject,
): ArticleStatus[] {
  const statuses: ArticleStatus[] = ["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"];
  return statuses.filter(
    (status) => status === article.status || canTransitionArticle(viewer, article, status),
  );
}

/** Raison lisible de l'absence d'action, pour la liste du studio. */
export function readOnlyReason(
  viewer: ArticleViewer,
  article: ArticleSubject,
): string | null {
  if (canEditArticle(viewer, article) || canDeleteArticle(viewer, article)) {
    return null;
  }
  if (isOutOfAuthorHands(article.status)) {
    return "Article publié : hors périmètre de l'auteur";
  }
  if (!isAuthor(viewer, article)) {
    return "Article d'un autre auteur";
  }
  return "Lecture seule";
}
