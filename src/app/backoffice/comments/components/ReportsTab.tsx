import Link from "next/link";

import { moderateReport } from "@/app/backoffice/comments/actions";
import {
  CommentStatusBadge,
  ReportStatusBadge,
} from "@/app/backoffice/comments/components/ModerationBadges";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { REPORT_REASON_LABELS, commentExcerpt, isReportReason } from "@/lib/engagement";
import { formatDate } from "@/lib/formatDate";

/**
 * Onglet « Signalements » (WP10c).
 *
 * Trois issues par ligne : résoudre (le commentaire est rejeté), rejeter le
 * signalement (le commentaire reste tel quel), ou supprimer le commentaire.
 */

export type ReportRow = {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  reporter: { name: string; email: string };
  resolvedBy: { name: string } | null;
  comment: {
    id: string;
    content: string;
    status: string;
    author: { id: string; name: string };
    article: { title: string; slug: string };
  };
};

export function ReportsTab({
  rows,
  total,
  page,
  pageSize,
  status,
  basePath,
  query,
}: {
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  status: string;
  basePath: string;
  query: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (target: number) => {
    const params = new URLSearchParams({ ...query, tab: "reports", page: String(target) });
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="mt-6">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <input type="hidden" name="tab" value="reports" />
        <Select
          name="status"
          label="Statut du signalement"
          className="min-w-[14rem]"
          defaultValue={status}
          options={[
            { value: "PENDING", label: "À traiter" },
            { value: "REVIEWED", label: "En cours" },
            { value: "RESOLVED", label: "Résolu" },
            { value: "DISMISSED", label: "Rejeté" },
          ]}
          placeholder="Tous les statuts"
        />
        <div className="flex items-center gap-2">
          <Button type="submit">Filtrer</Button>
          <Link href={`${basePath}?tab=reports`} className="text-sm font-semibold text-primary-700 underline">
            Réinitialiser
          </Link>
        </div>
      </form>

      <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-700">
        {total} signalement{total > 1 ? "s" : ""} · page {page} / {totalPages}
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Signalements de commentaires</caption>
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                Commentaire signalé
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Raison
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Reporter
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Statut
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Date
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                  Aucun signalement ne correspond à ce filtre.
                </td>
              </tr>
            ) : (
              rows.map((report) => (
                <tr key={report.id} className="align-top hover:bg-gray-50">
                  <td className="max-w-md px-3 py-3">
                    <Link
                      href={`/article/${report.comment.article.slug}`}
                      className="text-blue-700 underline transition-colors hover:text-blue-900"
                    >
                      {commentExcerpt(report.comment.content)}
                    </Link>
                    <span className="mt-1 block text-xs text-gray-500">
                      par {report.comment.author.name} · {report.comment.article.title}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500">
                      statut du commentaire :{" "}
                      <CommentStatusBadge status={report.comment.status} />
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-700">
                    <span className="font-medium">
                      {isReportReason(report.reason) ? REPORT_REASON_LABELS[report.reason] : report.reason}
                    </span>
                    {report.details ? (
                      <span className="mt-1 block text-xs text-gray-500">
                        {commentExcerpt(report.details, 120)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <span className="block font-medium text-gray-900">{report.reporter.name}</span>
                    <span className="block text-xs text-gray-500">{report.reporter.email}</span>
                  </td>
                  <td className="px-3 py-3">
                    <ReportStatusBadge status={report.status} />
                    {report.resolvedAt && report.resolvedBy ? (
                      <span className="mt-1 block text-xs text-gray-500">par {report.resolvedBy.name}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                    {formatDate(report.createdAt)}
                  </td>
                  <td className="px-3 py-3">
                    <form action={moderateReport.bind(null, report.id)} className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        name="intent"
                        value="resolve"
                        className="text-sm font-medium text-green-700 underline transition-colors hover:text-green-900"
                      >
                        Résoudre
                      </button>
                      <button
                        type="submit"
                        name="intent"
                        value="dismiss"
                        className="text-sm font-medium text-gray-700 underline transition-colors hover:text-gray-900"
                      >
                        Rejeter le signalement
                      </button>
                      <button
                        type="submit"
                        name="intent"
                        value="delete"
                        className="text-sm font-medium text-red-700 underline transition-colors hover:text-red-900"
                      >
                        Supprimer le commentaire
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Pagination des signalements" className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="font-semibold text-blue-700 underline">
              ← Page précédente
            </Link>
          ) : (
            <span className="text-gray-400">← Page précédente</span>
          )}
          <span className="text-gray-600">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="font-semibold text-blue-700 underline">
              Page suivante →
            </Link>
          ) : (
            <span className="text-gray-400">Page suivante →</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
