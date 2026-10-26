/**
 * Petites reprises sur les erreurs transitoires de PostgreSQL.
 *
 * En production, Neon peut fermer une connexion inactive ou déplacer une
 * instance ; en développement, la passerelle WebSocket locale peut perdre un
 * socket pendant une recompilation. Une opération de lecture/écriture brève
 * peut alors échouer sans que les données soient en cause. On rejoue uniquement
 * les erreurs explicitement transitoires, jamais une erreur métier.
 */

const TRANSIENT_MESSAGES = [
  "unable to start a transaction",
  "transaction already closed",
  "transaction api error",
  "connection terminated",
  "connection reset",
  "econnreset",
  "etimedout",
  "timed out fetching a new connection",
  "can't reach database server",
  "server has closed the connection",
];

export function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return TRANSIENT_MESSAGES.some((fragment) => message.includes(fragment));
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}
