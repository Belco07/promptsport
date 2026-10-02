import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

/**
 * Tableau de bord de la rédaction (studio).
 */
export default async function StudioPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const displayName = session.user.name ?? session.user.email ?? "auteur";

  return (
    <div className="px-8 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">
        Bienvenue dans la rédaction, {displayName}
      </h1>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/studio/articles"
          className="inline-block rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-800"
        >
          Gérer les articles
        </Link>
        <Link
          href="/studio/categories"
          className="inline-block rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100"
        >
          Gérer les catégories
        </Link>
      </div>
    </div>
  );
}
