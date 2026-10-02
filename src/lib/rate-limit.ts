/**
 * Limitation de débit (WP10b) — en mémoire, par processus.
 *
 * LIMITE ASSUMÉE ET DOCUMENTÉE : le compteur vit dans une `Map` du processus
 * Node. Cela suffit à un déploiement mono-instance (ou au développement), mais
 * ne protège pas un déploiement multi-instances ou serverless : chaque instance
 * aurait son propre compteur. Le passage à un stockage partagé (Redis, table
 * dédiée) est à prévoir avant une mise en production répartie.
 *
 * Le nettoyage des fenêtres expirées est paresseux : il a lieu à la lecture,
 * pour ne pas dépendre d'un minuteur qui empêcherait le processus de sortir.
 */

export type RateLimitOptions = {
  /** Nombre d'actions autorisées par fenêtre. */
  max: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
};

/** Limite demandée par le brief : 10 commentaires par heure et par utilisateur. */
export const COMMENT_RATE_LIMIT: RateLimitOptions = {
  max: 10,
  windowMs: 60 * 60 * 1000,
};

/**
 * Limite demandée par le brief WP11c : 3 inscriptions à la newsletter par heure
 * et par adresse IP. Le formulaire public est la seule porte d'entrée ouverte à
 * un visiteur anonyme : c'est aussi la plus exposée au remplissage automatique.
 */
export const NEWSLETTER_RATE_LIMIT: RateLimitOptions = {
  max: 3,
  windowMs: 60 * 60 * 1000,
};

/**
 * Limite demandée par le brief WP11e : 20 e-mails de notification par heure et
 * par utilisateur. Au-delà, la notification in-app est bien créée, mais l'e-mail
 * n'est pas envoyé : un fil de discussion très actif ne doit pas transformer la
 * boîte mail d'un lecteur en inondation.
 */
export const NOTIFICATION_EMAIL_RATE_LIMIT: RateLimitOptions = {
  max: 20,
  windowMs: 60 * 60 * 1000,
};

/**
 * Adresse du client, telle que la voit le serveur.
 *
 * `x-forwarded-for` est fourni par le proxy : il n'est fiable que derrière un
 * proxy de confiance (Vercel, Nginx…), sinon un client peut le falsifier pour
 * changer de compteur. Aucun contournement côté application : c'est une limite
 * de déploiement, documentée dans le README.
 */
export function clientIpFromHeaders(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headerList.get("x-real-ip")?.trim() || "inconnue";
}

type Entry = { count: number; resetAt: number };

const buckets = new Map<string, Entry>();

export type RateLimitState = {
  allowed: boolean;
  /** Actions encore possibles dans la fenêtre courante (0 si bloqué). */
  remaining: number;
  /** Temps d'attente avant réinitialisation, en millisecondes. */
  retryAfterMs: number;
};

/** Horodatage courant, isolé pour permettre un test déterministe. */
function now(): number {
  return Date.now();
}

/**
 * Enregistre une action pour `key` et indique si elle est autorisée. Une action
 * refusée n'incrémente pas le compteur : l'utilisateur ne repousse pas sa
 * fenêtre en insistant.
 */
export function consumeRateLimit(key: string, options: RateLimitOptions = COMMENT_RATE_LIMIT): RateLimitState {
  const timestamp = now();
  const entry = buckets.get(key);

  if (!entry || entry.resetAt <= timestamp) {
    buckets.set(key, { count: 1, resetAt: timestamp + options.windowMs });
    return { allowed: true, remaining: options.max - 1, retryAfterMs: 0 };
  }

  if (entry.count >= options.max) {
    return { allowed: false, remaining: 0, retryAfterMs: entry.resetAt - timestamp };
  }

  entry.count += 1;
  return { allowed: true, remaining: options.max - entry.count, retryAfterMs: 0 };
}

/**
 * Consulte l'état d'une clé sans consommer d'action (affichage, tests).
 * Purge au passage les fenêtres expirées.
 */
export function peekRateLimit(key: string, options: RateLimitOptions = COMMENT_RATE_LIMIT): RateLimitState {
  const timestamp = now();
  const entry = buckets.get(key);

  if (!entry) {
    return { allowed: true, remaining: options.max, retryAfterMs: 0 };
  }
  if (entry.resetAt <= timestamp) {
    buckets.delete(key);
    return { allowed: true, remaining: options.max, retryAfterMs: 0 };
  }

  const remaining = Math.max(0, options.max - entry.count);
  return { allowed: remaining > 0, remaining, retryAfterMs: entry.resetAt - timestamp };
}

/** Réinitialise un compteur (ou tous) — utilisé par les contrôles automatisés. */
export function resetRateLimit(key?: string): void {
  if (key === undefined) {
    buckets.clear();
    return;
  }
  buckets.delete(key);
}

/** Nombre de compteurs actifs (diagnostic et tests). */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

/** « 12 min », « 45 s », « 1 h 05 » : durée lisible pour l'utilisateur. */
export function formatRetryAfter(retryAfterMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} s`;
  }

  const totalMinutes = Math.ceil(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, "0")}`;
}

/** Message affiché lorsque la limite est atteinte (formulation du brief). */
export function rateLimitMessage(
  retryAfterMs: number,
  options: RateLimitOptions = COMMENT_RATE_LIMIT,
): string {
  return `Vous avez atteint la limite de ${options.max} commentaires par heure. Réessayez dans ${formatRetryAfter(
    retryAfterMs,
  )}.`;
}

/** Même message, formulé pour l'inscription à la newsletter (WP11c). */
export function newsletterRateLimitMessage(retryAfterMs: number): string {
  return `Vous avez atteint la limite de ${NEWSLETTER_RATE_LIMIT.max} inscriptions par heure. Réessayez dans ${formatRetryAfter(
    retryAfterMs,
  )}.`;
}

/** Message journalisé lorsqu'un e-mail de notification est écarté (WP11e). */
export function notificationEmailRateLimitMessage(retryAfterMs: number): string {
  return `limite de ${NOTIFICATION_EMAIL_RATE_LIMIT.max} e-mails de notification par heure atteinte (nouvel essai possible dans ${formatRetryAfter(
    retryAfterMs,
  )})`;
}
