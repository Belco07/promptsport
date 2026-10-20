import { prisma } from "@/lib/prisma";

/**
 * Rétention de la veille (WP41).
 *
 * Les alertes collectées sont conservées 48 h, puis supprimées pour éviter que
 * la table de veille ne grossisse sans limite. La purge est déclenchée par le
 * script de collecte et à l'ouverture du backoffice : même si le cron/script
 * n'est pas exécuté pendant plusieurs jours, la consultation nettoie la base.
 *
 * Les articles créés à partir d'une alerte ne sont pas concernés : seul le
 * résultat de veille disparaît, les brouillons restent dans le studio.
 */
export const NEWS_ALERT_RETENTION_MS = 48 * 60 * 60 * 1000;

/** Date limite avant laquelle une alerte est considérée comme expirée. */
export function newsAlertCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - NEWS_ALERT_RETENTION_MS);
}

/** Vrai si l'élément de flux est assez récent pour entrer dans la veille. */
export function isRecentNewsItem(publishedAt: Date, now: Date = new Date()): boolean {
  return publishedAt.getTime() >= newsAlertCutoff(now).getTime();
}

/** Supprime les alertes créées il y a plus de 48 h. Retourne le nombre purgé. */
export async function cleanupOldNewsAlerts(now: Date = new Date()): Promise<number> {
  const result = await prisma.newsAlert.deleteMany({
    where: { createdAt: { lt: newsAlertCutoff(now) } },
  });
  return result.count;
}
