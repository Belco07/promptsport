import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

import { StudioNav } from "./StudioNav";
import { logout } from "./logout-action";

/**
 * Layout de l'espace de rédaction (studio).
 * Barre latérale : Tableau de bord, Articles, Catégories, Voir le site, Se déconnecter.
 */
export default async function StudioLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (!["ADMIN", "EDITOR", "JOURNALIST"].includes(session.user.role)) redirect("/mon-compte");

  const liveMatch = await prisma.match.findFirst({
    where: { status: "LIVE" },
    select: { id: true },
  });

  const displayName = session.user.name ?? session.user.email ?? "auteur";

  return (
    <div className="workspace-theme flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-border bg-card p-4">
        <div>
          <p className="mb-6 px-3 text-sm font-bold uppercase tracking-wide text-foreground">
            Rédaction
          </p>
          <StudioNav liveMatchId={liveMatch?.id} />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
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
