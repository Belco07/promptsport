import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

import { BackofficeNav } from "./BackofficeNav";
import { logout } from "@/app/studio/logout-action";

/**
 * Layout du backoffice (administration).
 *
 * La barre latérale occupe la hauteur de l'écran et reste collée en haut : la
 * navigation défile indépendamment si elle dépasse, tandis que le bloc compte
 * et « Se déconnecter » reste ancré en bas (WP43).
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

  if (session.user.role !== "ADMIN") redirect("/mon-compte");

  const displayName = session.user.name ?? session.user.email ?? "auteur";

  return (
    <div className="workspace-theme flex min-h-screen bg-background">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-card p-4">
        <p className="mb-6 shrink-0 px-3 text-sm font-bold uppercase tracking-wide text-foreground">
          Backoffice
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <BackofficeNav />
        </div>

        <div className="mt-auto shrink-0 space-y-2 border-t border-border pt-4">
          <p className="px-3 text-xs text-muted-foreground">
            Connecté : <span className="font-medium text-foreground">{displayName}</span>
          </p>
          <Link
            href="/"
            className="block rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Voir le site
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
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
