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
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        Bienvenue dans la rédaction, {displayName}
      </h1>

      <div className="mt-8 flex flex-wrap gap-4">
        <Link
          href="/studio/articles"
          className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          Gérer les articles
        </Link>
        <Link
          href="/studio/categories"
          className="inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Gérer les catégories
        </Link>
      </div>
    </div>
  );
}
