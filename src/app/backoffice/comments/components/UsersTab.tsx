import Link from "next/link";

import { unbanUser } from "@/app/backoffice/comments/actions";
import { BanStatusBadge } from "@/app/backoffice/comments/components/ModerationBadges";
import { formatDate } from "@/lib/formatDate";
import { isBanned } from "@/lib/engagement";

/**
 * Onglet « Utilisateurs » (WP10c) : auteurs ayant commenté, avec leurs
 * compteurs et leur statut de bannissement.
 *
 * « Bannir » ouvre le formulaire modal rendu par la page (paramètre `bannir`) ;
 * « Débannir » est une Server Action liée à l'auteur.
 */

export type UserRow = {
  id: string;
  name: string;
  email: string;
  bannedUntil: Date | null;
  banReason: string | null;
  comments: number;
  rejected: number;
  flagged: number;
};

export function UsersTab({
  rows,
  total,
  page,
  pageSize,
  basePath,
  query,
  now,
}: {
  rows: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  basePath: string;
  query: Record<string, string>;
  now: Date;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const pageHref = (target: number) => {
    const params = new URLSearchParams({ ...query, tab: "users", page: String(target) });
    return `${basePath}?${params.toString()}`;
  };

  const banHref = (userId: string) => {
    const params = new URLSearchParams({ ...query, tab: "users", bannir: userId, page: String(page) });
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="mt-6">
      <p className="rounded-lg border border-border bg-muted px-4 py-3 text-sm font-medium text-foreground">
        {total} auteur{total > 1 ? "s" : ""} ayant commenté · page {page} / {totalPages}
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Auteurs ayant commenté</caption>
          <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-3 font-semibold">
                Auteur
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Commentaires
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Rejetés
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Signalés
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Bannissement
              </th>
              <th scope="col" className="px-3 py-3 font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Aucun auteur n&apos;a encore commenté.
                </td>
              </tr>
            ) : (
              rows.map((author) => (
                <tr key={author.id} className="align-top hover:bg-muted">
                  <td className="px-3 py-3">
                    <Link
                      href={`/backoffice/users/${author.id}/edit`}
                      className="font-medium text-foreground underline transition-colors hover:text-editorial-link"
                    >
                      {author.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{author.email}</span>
                  </td>
                  <td className="px-3 py-3 font-medium text-foreground">{author.comments}</td>
                  <td className="px-3 py-3 text-foreground">{author.rejected}</td>
                  <td className="px-3 py-3 text-foreground">{author.flagged}</td>
                  <td className="px-3 py-3">
                    <BanStatusBadge author={author} now={now} />
                    {isBanned(author, now) && author.bannedUntil ? (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        jusqu&apos;au {formatDate(author.bannedUntil)}
                        {author.banReason ? ` — ${author.banReason}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={banHref(author.id)}
                        className="text-sm font-medium text-status-error-foreground underline transition-colors hover:text-status-error-foreground"
                      >
                        Bannir
                      </Link>
                      {author.bannedUntil ? (
                        <form action={unbanUser.bind(null, author.id)}>
                          <button
                            type="submit"
                            className="text-sm font-medium text-status-success-foreground underline transition-colors hover:text-green-900"
                          >
                            Débannir
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav aria-label="Pagination des utilisateurs" className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="font-semibold text-editorial-link underline">
              ← Page précédente
            </Link>
          ) : (
            <span className="text-muted-foreground">← Page précédente</span>
          )}
          <span className="text-muted-foreground">
            Page {page} sur {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="font-semibold text-editorial-link underline">
              Page suivante →
            </Link>
          ) : (
            <span className="text-muted-foreground">Page suivante →</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
