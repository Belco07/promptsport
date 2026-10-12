import { createCategory } from "../actions";
import { CategoryForm } from "../CategoryForm";

export default function NewCategoryPage() {
  return (
    <div className="px-8 py-10">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-foreground">
        Nouvelle catégorie
      </h1>

      <CategoryForm action={createCategory} submitLabel="Créer la catégorie" />
    </div>
  );
}
