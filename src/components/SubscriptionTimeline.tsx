import { formatDate } from "@/lib/formatDate";

/**
 * Timeline verticale du journal d'abonnement (WP7e).
 *
 * Utilisée par l'espace abonné et par le backoffice : chaque événement est
 * daté, coloré selon sa nature, et ses métadonnées sont résumées.
 */

export const SUBSCRIPTION_EVENT_LABELS: Record<string, string> = {
  CREATED: "Abonnement créé",
  ACTIVATED: "Abonnement activé",
  RENEWED: "Renouvellement",
  CANCELED: "Annulation",
  REACTIVATED: "Réactivation",
  PAST_DUE: "Paiement en retard",
  EXPIRED: "Abonnement expiré",
  REFUNDED: "Remboursement",
};

const DOT_COLORS: Record<string, string> = {
  CREATED: "bg-blue-600",
  ACTIVATED: "bg-green-600",
  RENEWED: "bg-green-600",
  CANCELED: "bg-gray-500",
  REACTIVATED: "bg-blue-600",
  PAST_DUE: "bg-orange-500",
  EXPIRED: "bg-red-600",
  REFUNDED: "bg-amber-500",
};

export type TimelineEvent = {
  id: string;
  type: string;
  createdAt: Date;
  metadata?: unknown;
};

/** Résumé lisible des métadonnées (montant, identifiant Stripe, motif…). */
function summarizeMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const entries = Object.entries(metadata as Record<string, unknown>).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  if (entries.length === 0) return null;
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key} : ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
    .join(" · ");
}

export function SubscriptionTimeline({
  events,
  emptyLabel = "Aucun événement enregistré.",
}: {
  events: TimelineEvent[];
  emptyLabel?: string;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-gray-600">{emptyLabel}</p>;
  }

  return (
    <ol className="relative space-y-5 border-l border-gray-200 pl-6">
      {events.map((event) => {
        const meta = summarizeMetadata(event.metadata);
        return (
          <li key={event.id} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-[1.85rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${
                DOT_COLORS[event.type] ?? "bg-gray-400"
              }`}
            />
            <p className="text-sm font-medium text-gray-900">
              {SUBSCRIPTION_EVENT_LABELS[event.type] ?? event.type}
            </p>
            <p className="text-xs text-gray-500">
              <time dateTime={event.createdAt.toISOString()}>{formatDate(event.createdAt)}</time>
            </p>
            {meta ? <p className="mt-1 break-words text-xs text-gray-500">{meta}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
