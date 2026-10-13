/**
 * Formatage des dates en français.
 *  - formatDate      : « 12 septembre 2026 »
 *  - formatMatchDate : « sam. 12 sept. à 21:00 »
 */

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const matchDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const matchTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formate une date en français lisible (« 12 septembre 2026 »). */
export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : "";
}

/** Format court pour les matchs (« sam. 12 sept. à 21:00 »). */
export function formatMatchDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return "";
  }
  return `${matchDateFormatter.format(date)} à ${matchTimeFormatter.format(date)}`;
}

export function formatRelativeDate(value: Date | string | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return "aucune mise à jour enregistrée";
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
  if (!minutes) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} jour${days > 1 ? "s" : ""}`;
}
