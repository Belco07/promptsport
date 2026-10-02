import Link from "next/link";

import { StatusBadge } from "@/components/StatusBadge";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
    include: { author: true, category: true },
  });

  return (
    <div className="px-8 py-10">
      <div className="mb-2 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Articles</h1>
        <Link
          href="/studio/articles/new"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Nouvel article
        </Link>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Tous les articles de la rédaction sont visibles ici. Vous ne pouvez agir que sur ceux que
        votre rôle autorise : vos articles non publiés, ou tous pour un éditeur.
      </p>

      {articles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
          Aucun article pour le moment. Créez le premier avec « Nouvel article ».
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Titre</th>
                <th scope="col" className="px-4 py-3 font-semibold">Catégorie</th>
                <th scope="col" className="px-4 py-3 font-semibold">Auteur</th>
                <th scope="col" className="px-4 py-3 font-semibold">Statut</th>
                <th scope="col" className="px-4 py-3 font-semibold">Date de création</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {articles.map((article) => {
                const subject = { authorId: article.authorId, status: article.status };
                const editable = canEditArticle(viewer, subject);
                const deletable = canDeleteArticle(viewer, subject);
                const statuses = allowedArticleStatuses(viewer, subject);
                const reason = readOnlyReason(viewer, subject);

                return (
                  <tr key={article.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {article.title}
                      <span className="block text-xs font-normal text-gray-400">
                        /{article.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{article.category.name}</td>
                    <td className="px-4 py-3 text-gray-700">{article.author.name}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={article.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-600">
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
                            className="text-blue-700 underline hover:text-blue-900"
                          >
                            Éditer
                          </Link>
                        ) : null}
                        {deletable ? (
                          <DeleteArticleButton id={article.id} title={article.title} />
                        ) : null}
                        {reason ? (
                          <span className="text-xs text-gray-500">{reason}</span>
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
