import Link from "next/link";

import { prisma } from "@/lib/prisma";

import { DeleteCategoryButton } from "./DeleteCategoryButton";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { articles: true } } },
  });

  return (
    <div className="px-8 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Catégories
        </h1>
        <Link
          href="/studio/categories/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Nouvelle catégorie
        </Link>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucune catégorie pour le moment.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Nom</th>
                <th scope="col" className="px-4 py-3 font-semibold">Slug</th>
                <th scope="col" className="px-4 py-3 font-semibold">Articles</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-muted">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {category.name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">/{category.slug}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {category._count.articles}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/studio/categories/${category.id}/edit`}
                        className="text-editorial-link underline hover:text-editorial-link"
                      >
                        Éditer
                      </Link>
                      <DeleteCategoryButton
                        id={category.id}
                        name={category.name}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
