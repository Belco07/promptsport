import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

import { updateCategory } from "../../actions";
import { CategoryForm } from "../../CategoryForm";

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const category = await prisma.category.findUnique({ where: { id } });

  if (!category) {
    notFound();
  }

  const updateWithId = updateCategory.bind(null, category.id);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-gray-900">
        Modifier la catégorie
      </h1>
      <p className="mb-6 text-sm text-gray-500">/{category.slug}</p>

      <CategoryForm
        action={updateWithId}
        defaultValues={{ name: category.name, slug: category.slug }}
        submitLabel="Mettre à jour"
      />
    </div>
  );
}
