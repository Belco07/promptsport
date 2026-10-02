import Link from "next/link";

import { bulkModerate, moderateComment } from "@/app/backoffice/comments/actions";
import {
  CommentStatusBadge,
  ReportStatusBadge,
} from "@/app/backoffice/comments/components/ModerationBadges";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  REPORT_REASON_LABELS,
  commentExcerpt,
  isReportReason,
} from "@/lib/engagement";
import { formatDate } from "@/lib/formatDate";

/**
 * Onglet « Commentaires » (WP10c, complété) : filtres, sélection multiple,
 * actions individuelles et pagination.
 *
 * Les signalements d'un commentaire sont affichés dans la ligne — auteur,
 * motif, précisions et état du traitement — pour qu'un modérateur n'ait pas à
 * ouvrir l'onglet Signalements afin de comprendre pourquoi un commentaire est
 * signalé.
 *
 * Aucun JavaScript côté client :
 *  - la barre d'actions groupées est un formulaire dont les cases à cocher sont
 *    rattachées par l'attribut HTML `form` (un formulaire ne peut pas envelopper
 *    le tableau, chaque ligne contenant déjà son propre formulaire) ;
 *  - chaque ligne possède un formulaire à trois boutons (`intent`).
 */

export type CommentReport = {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: Date;
  reporter: { name: string; email: string };
};

export type CommentRow = {
  id: string;
  content: string;
  status: string;
  createdAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string; email: string };
  article: { title: string; slug: string };
  reports: CommentReport[];
};

export type CommentsFilters = {
  status: string;
  article: string;
  author: string;
};

export function CommentsTab({
  rows,
  total,
  page,
  pageSize,
  filters,
  articles,
  basePath,
  query,
}: {
  rows: CommentRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: CommentsFilters;
  articles: Array<{ slug: string; title: string }>;
  basePath: string;
  query: Record<string, string>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (target: number) => {
    const params = new URLSearchParams({ ...query, tab: "comments", page: String(target) });
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="mt-6">
      {/* Filtres : formulaire GET, sans JavaScript. */}
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <input type="hidden" name="tab" value="comments" />
        <Select
          name="status"
          label="Statut"
          className="min-w-[12rem]"
          defaultValue={filters.status}
          options={[
            { value: "PENDING", label: "En attente" },
            { value: "APPROVED", label: "Approuvé" },
            { value: "REJECTED", label: "Rejeté" },
            { value: "FLAGGED", label: "Signalé" },
            { value: "DELETED", label: "Supprimé" },
          ]}
          placeholder="Tous les statuts"
        />
        <Select
          name="article"
          label="Article"
          className="min-w-[16rem]"
          defaultValue={filters.article}
          options={articles.map((article) => ({ value: article.slug, label: article.title }))}
          placeholder="Tous les articles"
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="champ-auteur" className="text-sm font-medium text-neutral-800">
            Auteur
          </label>
          <input
            id="champ-auteur"
            name="author"
            type="text"
            defaultValue={filters.author}
            placeholder="Nom ou e-mail"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit">Filtrer</Button>
          <Link href={`${basePath}?tab=comments`} className="text-sm font-semibold text-primary-700 underline">
            Réinitialiser
          </Link>
        </div>
      </form>

      {/* Barre d'actions groupées : les cases du tableau lui sont rattachées. */}
      <form id="bulk-form" action={bulkModerate} className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
        <p className="text-sm font-medium text-gray-700">
          {total} commentaire{total > 1 ? "s" : ""} · page {page} / {totalPages}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="submit" name="intent" value="approve" size="sm">
            Approuver la sélection
          </Button>
          <Button type="submit" name="intent" value="reject" variant="secondary" size="sm">
            Rejeter la sélection
          </Button>
          <Button type="submit" name="intent" value="delete" variant="danger" size="sm">
            Supprimer la sélection
          </Button>
        </div>
      </form>

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Commentaires à modérer</caption>
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                <span className="sr-only">Sélection</span>
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Auteur
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Article
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Commentaire
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
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-500">
                  Aucun commentaire ne correspond à ces filtres.
                </td>
              </tr>
            ) : (
              rows.map((comment) => (
                <tr key={comment.id} className="align-top hover:bg-gray-50">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      name="ids"
                      value={comment.id}
                      form="bulk-form"
                      aria-label={`Sélectionner le commentaire de ${comment.author.name}`}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/backoffice/users/${comment.author.id}/edit`}
                      className="font-medium text-gray-900 underline transition-colors hover:text-blue-800"
                    >
                      {comment.author.name}
                    </Link>
                    <span className="block text-xs text-gray-500">{comment.author.email}</span>
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/article/${comment.article.slug}`}
                      className="text-blue-700 underline transition-colors hover:text-blue-900"
                    >
                      {comment.article.title}
                    </Link>
                  </td>
                  <td className="max-w-md px-3 py-3 text-gray-700">
                    {commentExcerpt(comment.content)}
                    {comment.reports.length > 0 ? (
                      <ul className="mt-2 space-y-1.5 border-l-2 border-red-200 pl-2.5">
                        {comment.reports.map((report) => (
                          <li key={report.id} className="text-xs">
                            <span className="font-semibold text-red-800">
                              {isReportReason(report.reason)
                                ? REPORT_REASON_LABELS[report.reason]
                                : report.reason}
                            </span>
                            <span className="text-gray-600">
                              {" "}
                              — signalé le {formatDate(report.createdAt)} par{" "}
                              <span className="font-medium text-gray-800">
                                {report.reporter.name}
                              </span>{" "}
                              ({report.reporter.email})
                            </span>
                            <span className="ml-1 align-middle">
                              <ReportStatusBadge status={report.status} />
                            </span>
                            {report.details ? (
                              <span className="mt-0.5 block italic text-gray-600">
                                « {commentExcerpt(report.details, 160)} »
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <CommentStatusBadge status={comment.status} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">
                    {formatDate(comment.createdAt)}
                    {comment.editedAt ? (
                      <span className="block text-xs text-gray-400">modifié</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    {/* Un seul formulaire par ligne : le bouton cliqué porte l'intention. */}
                    <form action={moderateComment.bind(null, comment.id)} className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        name="intent"
                        value="approve"
                        className="text-sm font-medium text-green-700 underline transition-colors hover:text-green-900"
                      >
                        Approuver
                      </button>
                      <button
                        type="submit"
                        name="intent"
                        value="reject"
                        className="text-sm font-medium text-orange-700 underline transition-colors hover:text-orange-900"
                      >
                        Rejeter
                      </button>
                      <button
                        type="submit"
                        name="intent"
                        value="delete"
                        className="text-sm font-medium text-red-700 underline transition-colors hover:text-red-900"
                      >
                        Supprimer
                      </button>
                      <a
                        href={`/article/${comment.article.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-blue-700 underline transition-colors hover:text-blue-900"
                      >
                        Voir l&apos;article
                      </a>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Pagination des commentaires" className="mt-4 flex items-center justify-between text-sm">
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
