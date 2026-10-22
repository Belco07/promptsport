import Link from "next/link";

import { StatusBadge } from "@/components/StatusBadge";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { themeBadgeStyle } from "@/lib/themes";
import {
  allowedArticleStatuses,
  canDeleteArticle,
  canEditArticle,
  readOnlyReason,
} from "@/lib/roles";

import { DeleteArticleButton } from "./DeleteArticleButton";
import { StatusSelect } from "./StatusSelect";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export default async function ArticlesPage() {
  const session = await auth();
  // Toute la rédaction voit tous les articles ; les actions dépendent du rôle et
  // de la propriété de l'article (WP11).
  const viewer = { id: session?.user?.id ?? "", role: session?.user?.role ?? null };

  const articles = await prisma.article.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      featuredSlots: { select: { slot: true } },
      author: true,
      category: true,
      // WP16b : thèmes associés, affichés en badges dans la colonne « Thèmes ».
      themes: { orderBy: { name: "asc" } },
    },
  });

  return (
    <div className="px-8 py-10">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Articles</h1>
        <Link
          href="/studio/articles/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Nouvel article
        </Link>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Tous les articles de la rédaction sont visibles ici. Vous ne pouvez agir que sur ceux que
        votre rôle autorise : vos articles, même publiés (hors archives), ou tous pour un éditeur.
      </p>

      {articles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun article pour le moment. Créez le premier avec « Nouvel article ».
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Titre</th>
                <th scope="col" className="px-4 py-3 font-semibold">Catégorie</th>
                <th scope="col" className="px-4 py-3 font-semibold">Thèmes</th>
                <th scope="col" className="px-4 py-3 font-semibold">Auteur</th>
                <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                <th scope="col" className="px-4 py-3 font-semibold">Date de création</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {articles.map((article) => {
                const subject = { authorId: article.authorId, status: article.status };
                const editable = canEditArticle(viewer, subject);
                const deletable = canDeleteArticle(viewer, subject);
                const statuses = allowedArticleStatuses(viewer, subject);
                const reason = readOnlyReason(viewer, subject);

                return (
                  <tr key={article.id} className="hover:bg-muted">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {article.title}
                      <span className={`ml-2 inline-block rounded-full px-2 py-1 text-xs font-bold ${article.format === "FLASH" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" : article.format === "ANALYSIS" ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200" : "bg-muted text-foreground"}`}>{article.format === "ANALYSIS" ? "ANALYSE" : article.format}</span>
                      {article.featuredSlots.length > 0 && <span className="ml-2 inline-block rounded bg-muted px-2 py-1 text-xs font-bold text-foreground">À la une</span>}
                      <span className="block text-xs font-normal text-muted-foreground">
                        /{article.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground">{article.category.name}</td>
                    <td className="px-4 py-3">
                      {article.themes.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {article.themes.map((theme) => (
                            <span key={theme.id} className="theme-badge" style={themeBadgeStyle(theme.color)}>
                              {theme.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground">{article.author.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={article.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <time dateTime={article.createdAt.toISOString()}>
                        {dateFormatter.format(article.createdAt)}
                      </time>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {statuses.length > 1 ? (
                          <StatusSelect
                            articleId={article.id}
                            currentStatus={article.status}
                            allowedStatuses={statuses}
                          />
                        ) : null}
                        {editable ? (
                          <Link
                            href={`/studio/articles/${article.id}/edit`}
                            className="text-editorial-link underline hover:text-editorial-link"
                          >
                            Éditer
                          </Link>
                        ) : null}
                        {deletable ? (
                          <DeleteArticleButton id={article.id} title={article.title} />
                        ) : null}
                        {reason ? (
                          <span className="text-xs text-muted-foreground">{reason}</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
