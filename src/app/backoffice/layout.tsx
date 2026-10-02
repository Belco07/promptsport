import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { BackofficeNav } from "./BackofficeNav";
import { logout } from "@/app/studio/logout-action";

/**
 * Layout du backoffice (administration).
 * Barre latérale : Tableau de bord, Utilisateurs/Rôles/Paramètres (désactivés),
 * Voir le site, Se déconnecter.
 */
export default async function BackofficeLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const displayName = session.user.name ?? session.user.email ?? "auteur";

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-gray-200 bg-white p-4">
        <div>
          <p className="mb-6 px-3 text-sm font-bold uppercase tracking-wide text-gray-900">
            Backoffice
          </p>
          <BackofficeNav />
        </div>

        <div className="space-y-2 border-t border-gray-200 pt-4">
          <p className="px-3 text-xs text-gray-500">
            Connecté : <span className="font-medium text-gray-700">{displayName}</span>
          </p>
          <Link
            href="/"
            className="block rounded-md px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
          >
            Voir le site
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100"
            >
              Se déconnecter
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
