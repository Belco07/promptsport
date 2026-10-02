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
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Catégories
        </h1>
        <Link
          href="/studio/categories/new"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Nouvelle catégorie
        </Link>
      </div>

      {categories.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
          Aucune catégorie pour le moment.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Nom</th>
                <th scope="col" className="px-4 py-3 font-semibold">Slug</th>
                <th scope="col" className="px-4 py-3 font-semibold">Articles</th>
                <th scope="col" className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((category) => (
                <tr key={category.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {category.name}
                  </td>
                  <td className="px-4 py-3 text-gray-600">/{category.slug}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {category._count.articles}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/studio/categories/${category.id}/edit`}
                        className="text-blue-700 underline hover:text-blue-900"
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
