import Link from "next/link";

import { unsubscribeSubscriber } from "@/app/backoffice/newsletter/actions";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/formatDate";
import {
  NEWSLETTER_PAGE_SIZE,
  SUBSCRIBER_STATUS_LABELS,
  SUBSCRIBER_STATUS_TONES,
  subscriberSourceLabel,
  type SubscriberStatus,
} from "@/lib/newsletter";

/**
 * Onglet « Abonnés » de /backoffice/newsletter (WP11a).
 *
 * Tableau en lecture seule : email, nom, statut, origine, date d'inscription et
 * listes thématiques. Deux actions : « Voir » (panneau de détail rendu par la
 * page, via `?abonne=`) et « Désabonner » (Server Action liée).
 *
 * Composant serveur : aucune interaction locale, tout passe par des liens et un
 * formulaire — l'administration fonctionne sans JavaScript.
 */

export type SubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  status: SubscriberStatus;
  source: string | null;
  createdAt: Date;
  lists: { id: string; name: string }[];
};

export function SubscribersTab({
  rows,
  total,
  page,
  basePath,
  query,
  detailId,
}: {
  rows: SubscriberRow[];
  total: number;
  page: number;
  basePath: string;
  query: Record<string, string>;
  /** Abonné dont le détail est affiché, s'il y en a un. */
  detailId?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / NEWSLETTER_PAGE_SIZE));

  const pageHref = (target: number) =>
    `${basePath}?${new URLSearchParams({ ...query, tab: "subscribers", page: String(target) }).toString()}`;

  const detailHref = (id: string) =>
    `${basePath}?${new URLSearchParams({
      ...query,
      tab: "subscribers",
      abonne: id,
      page: String(page),
    }).toString()}`;

  return (
    <div className="mt-6">
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-700">
        {total} abonné{total > 1 ? "s" : ""} · page {page} / {totalPages}
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Abonnés à la newsletter</caption>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                Email
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Nom
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Statut
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Origine
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Inscription
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Listes
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-neutral-500">
                  Aucun abonné pour le moment. Créez-en un dans Prisma Studio
                  (<code className="font-mono text-xs">npx prisma studio</code>).
                </td>
              </tr>
            ) : (
              rows.map((subscriber) => (
                <tr key={subscriber.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-3 font-medium text-neutral-900">{subscriber.email}</td>
                  <td className="px-3 py-3 text-neutral-700">{subscriber.name ?? "—"}</td>
                  <td className="px-3 py-3">
                    <Badge variant="status" tone={SUBSCRIBER_STATUS_TONES[subscriber.status]}>
                      {SUBSCRIBER_STATUS_LABELS[subscriber.status]}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-neutral-700">
                    {subscriberSourceLabel(subscriber.source)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                    {formatDate(subscriber.createdAt)}
                  </td>
                  <td className="px-3 py-3">
                    {subscriber.lists.length === 0 ? (
                      <span className="text-neutral-500">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {subscriber.lists.map((list) => (
                          <Badge key={list.id} variant="category" tone="primary">
                            {list.name}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={detailHref(subscriber.id)}
                        aria-current={detailId === subscriber.id ? "true" : undefined}
                        className="text-sm font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                      >
                        Voir
                      </Link>
                      {subscriber.status === "UNSUBSCRIBED" ? (
                        <span className="text-xs text-neutral-500">Désabonné</span>
                      ) : (
                        <form action={unsubscribeSubscriber.bind(null, subscriber.id)}>
                          <button
                            type="submit"
                            className="text-sm font-semibold text-danger-700 underline transition-colors hover:text-danger-800"
                          >
                            Désabonner
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav
          aria-label="Pagination des abonnés"
          className="mt-4 flex items-center justify-between text-sm"
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="font-semibold text-primary-700 underline">
              ← Page précédente
            </Link>
          ) : (
            <span className="text-neutral-400">← Page précédente</span>
          )}
          <span className="text-neutral-600">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="font-semibold text-primary-700 underline">
              Page suivante →
            </Link>
          ) : (
            <span className="text-neutral-400">Page suivante →</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
