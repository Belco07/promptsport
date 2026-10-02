import Link from "next/link";

import { duplicateCampaign } from "@/app/backoffice/newsletter/actions";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/formatDate";
import {
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_TONES,
  NEWSLETTER_PAGE_SIZE,
  openRate,
  type CampaignStatus,
} from "@/lib/newsletter";

/**
 * Onglet « Campagnes » de /backoffice/newsletter (WP11a).
 *
 * Tableau en lecture seule : sujet, liste, statut, date d'envoi, destinataires
 * et taux d'ouverture. Deux actions : « Voir » (panneau de détail rendu par la
 * page, via `?campagne=`) et « Dupliquer » (Server Action liée, la copie
 * revient en brouillon).
 *
 * Aucune création ni modification de campagne dans ce lot : le formulaire de
 * rédaction arrive au WP11d, l'envoi au WP11b.
 */

export type CampaignRow = {
  id: string;
  subject: string;
  status: CampaignStatus;
  listName: string;
  sentAt: Date | null;
  scheduledAt: Date | null;
  recipientCount: number;
  deliveredCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  createdAt: Date;
  createdByName: string;
  sendCount: number;
};

export function CampaignsTab({
  rows,
  total,
  page,
  basePath,
  query,
  detailId,
}: {
  rows: CampaignRow[];
  total: number;
  page: number;
  basePath: string;
  query: Record<string, string>;
  /** Campagne dont le détail est affiché, s'il y en a une. */
  detailId?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / NEWSLETTER_PAGE_SIZE));

  const pageHref = (target: number) =>
    `${basePath}?${new URLSearchParams({ ...query, tab: "campaigns", page: String(target) }).toString()}`;

  const detailHref = (id: string) =>
    `${basePath}?${new URLSearchParams({
      ...query,
      tab: "campaigns",
      campagne: id,
      page: String(page),
    }).toString()}`;

  return (
    <div className="mt-6">
      <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-700">
        {total} campagne{total > 1 ? "s" : ""} · page {page} / {totalPages}
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Campagnes de newsletter</caption>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                Sujet
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Liste
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Statut
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Envoi
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Destinataires
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Taux d&apos;ouverture
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
                  Aucune campagne pour le moment. Créez-en une dans Prisma Studio
                  (<code className="font-mono text-xs">npx prisma studio</code>).
                </td>
              </tr>
            ) : (
              rows.map((campaign) => (
                <tr key={campaign.id} className="align-top hover:bg-neutral-50">
                  <td className="px-3 py-3">
                    <span className="font-medium text-neutral-900">{campaign.subject}</span>
                    <span className="block text-xs text-neutral-500">
                      créée le {formatDate(campaign.createdAt)} par {campaign.createdByName}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="category" tone="primary">
                      {campaign.listName}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge variant="status" tone={CAMPAIGN_STATUS_TONES[campaign.status]}>
                      {CAMPAIGN_STATUS_LABELS[campaign.status]}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-neutral-700">
                    {campaign.sentAt
                      ? formatDate(campaign.sentAt)
                      : campaign.scheduledAt
                        ? `prévue le ${formatDate(campaign.scheduledAt)}`
                        : "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">
                    {campaign.recipientCount}
                    <span className="block text-xs text-neutral-500">
                      {campaign.deliveredCount} délivré{campaign.deliveredCount > 1 ? "s" : ""} ·{" "}
                      {campaign.sendCount} envoi{campaign.sendCount > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3 tabular-nums text-neutral-700">
                    {openRate(campaign)}
                    <span className="block text-xs text-neutral-500">
                      {campaign.openCount} ouverture{campaign.openCount > 1 ? "s" : ""} ·{" "}
                      {campaign.clickCount} clic{campaign.clickCount > 1 ? "s" : ""} ·{" "}
                      {campaign.bounceCount} rejet{campaign.bounceCount > 1 ? "s" : ""}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={detailHref(campaign.id)}
                        aria-current={detailId === campaign.id ? "true" : undefined}
                        className="text-sm font-semibold text-primary-700 underline transition-colors hover:text-primary-900"
                      >
                        Voir
                      </Link>
                      <form action={duplicateCampaign.bind(null, campaign.id)}>
                        <button
                          type="submit"
                          className="text-sm font-semibold text-neutral-600 underline transition-colors hover:text-neutral-900"
                        >
                          Dupliquer
                        </button>
                      </form>
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
          aria-label="Pagination des campagnes"
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
