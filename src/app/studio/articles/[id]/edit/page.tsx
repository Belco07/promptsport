import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allowedArticleStatuses, canEditArticle, canSetPremium, readOnlyReason } from "@/lib/roles";

import { updateArticle } from "../../actions";
import { ArticleForm } from "../../ArticleForm";

export const dynamic = "force-dynamic";

/**
 * Édition d'un article.
 *
 * L'accès est refusé (lecture seule) lorsque le rôle ou l'état de l'article ne
 * le permet pas : un journaliste ne modifie que ses propres articles non
 * publiés, et un article publié sort du périmètre de son auteur (WP11). La
 * Server Action applique la même règle de son côté.
 */
export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const viewer = { id: session?.user?.id ?? "", role: session?.user?.role ?? null };

  const [article, categories] = await Promise.all([
    prisma.article.findUnique({ where: { id } }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!article) {
    notFound();
  }

  const subject = { authorId: article.authorId, status: article.status };
  const editable = canEditArticle(viewer, subject);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
        {editable ? "Modifier l'article" : "Consulter l'article"}
      </h1>
      <p className="mb-6 text-sm text-gray-500">/{article.slug}</p>

      {editable ? (
        // La Server Action d'édition reçoit l'identifiant en première position.
        <ArticleForm
          action={updateArticle.bind(null, article.id)}
          categories={categories}
          submitLabel="Mettre à jour"
          allowedStatuses={allowedArticleStatuses(viewer, subject)}
          // Le caractère premium est décidé par un ADMIN ou un EDITOR : la case
          // reste informative pour les autres, et la Server Action conserve la
          // valeur en base (WP11).
          canSetPremium={canSetPremium(viewer.role)}
          defaultValues={{
            title: article.title,
            slug: article.slug,
            content: article.content,
            excerpt: article.excerpt ?? "",
            coverImageUrl: article.coverImageUrl ?? "",
            categoryId: article.categoryId,
            status: article.status,
            isPremium: article.isPremium,
          }}
        />
      ) : (
        <div className="max-w-2xl rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-sm font-medium text-gray-900">
            {readOnlyReason(viewer, subject) ?? "Lecture seule"}
          </p>
          <p className="mt-2 text-sm text-gray-600">
            {article.status === "PUBLISHED" || article.status === "ARCHIVED"
              ? "Cet article est publié : seule la rédaction en chef peut le modifier, le dépublier ou l'archiver. Demandez-lui une correction si nécessaire."
              : "Cet article appartient à un autre auteur. Vous pouvez le lire, mais pas le modifier."}
          </p>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-gray-700">Titre</dt>
              <dd className="text-gray-600">{article.title}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Statut</dt>
              <dd className="text-gray-600">{article.status}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Diffusion</dt>
              <dd className="text-gray-600">
                {article.isPremium ? "Réservé aux abonnés (premium)" : "Accès libre"}
              </dd>
            </div>
          </dl>
          <Link
            href="/studio/articles"
            className="mt-6 inline-block text-sm font-medium text-blue-700 underline hover:text-blue-900"
          >
            Retour à la liste des articles
          </Link>
        </div>
      )}
    </div>
  );
}
