import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canPublish, canSetPremium } from "@/lib/roles";

import { createArticle } from "../actions";
import { ArticleForm } from "../ArticleForm";

export const dynamic = "force-dynamic";

export default async function NewArticlePage() {
  const session = await auth();
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Un journaliste ne peut créer qu'un brouillon ou un article à relire : la
  // publication reste une décision éditoriale (WP11).
  const allowedStatuses = canPublish(session?.user?.role)
    ? (["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"] as const)
    : (["DRAFT", "REVIEW"] as const);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-gray-900">
        Nouvel article
      </h1>

      {categories.length === 0 ? (
        <p className="max-w-2xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Aucune catégorie en base : créez-en une avant de rédiger un article.
          La gestion des catégories arrive dans un lot ultérieur.
        </p>
      ) : (
        <ArticleForm
          action={createArticle}
          categories={categories}
          submitLabel="Créer l'article"
          allowedStatuses={[...allowedStatuses]}
          // Le caractère premium est un arbitrage éditorial (WP11) : la case
          // n'est proposée qu'aux rôles qui publient.
          canSetPremium={canSetPremium(session?.user?.role)}
        />
      )}
    </div>
  );
}
