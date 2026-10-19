import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { StudioLiveForm } from "@/components/StudioLiveForm";

/**
 * Console "Studio Live" (WP38) : un journaliste publie son commentaire
 * éditorial en direct sur une rencontre. Accessible aux rôles ADMIN, EDITOR
 * et JOURNALIST via le layout du studio.
 */
export default async function StudioLivePage({
  params,
}: Readonly<{
  params: Promise<{ matchId: string }>;
}>) {
  const session = await auth();
  if (!session?.user) {
    // Le layout redirige déjà, mais la page se protège elle-même.
    return notFound();
  }
  if (!["ADMIN", "EDITOR", "JOURNALIST"].includes(session.user.role)) {
    return notFound();
  }

  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      status: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
      competition: { select: { name: true } },
    },
  });
  if (!match) return notFound();

  const updates = await prisma.matchLiveUpdate.findMany({
    where: { matchId, authorId: session.user.id },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    include: { author: { select: { name: true } } },
  });

  const isLive = match.status === "LIVE";

  return (
    <div className="px-8 py-10">
      <nav className="mb-6 flex items-center gap-2">
        <a
          href="/studio"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Rédaction
        </a>
        <span className="text-xs text-muted-foreground">›</span>
        <span className="text-sm font-semibold text-foreground">Studio Live</span>
      </nav>

      <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
        Studio Live —{" "}
        {match.homeTeam.name} vs {match.awayTeam.name}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {match.competition.name} — publiez une intervention éditoriale qui
        apparaît immédiatement sur la fiche match publique.
      </p>

      {isLive && (
        <div className="mb-6 rounded-lg border border-accent bg-accent px-4 py-3 text-neutral-900 font-semibold">
          Match en direct — interventions diffusées en temps réel sur la fiche
          publique.
        </div>
      )}

      <section className="grid gap-6 md:grid-cols-12">
        <div className="md:col-span-4">
          <h2 className="mb-4 text-xl font-black uppercase text-foreground">
            Nouvelle intervention
          </h2>
          <StudioLiveForm matchId={matchId} />
        </div>

        <div className="md:col-span-8">
          <h2 className="mb-4 text-xl font-black uppercase text-foreground">
            Mes interventions sur ce match
          </h2>
          {updates.length === 0 ? (
            <p className="rounded-lg border border-border bg-muted p-6 text-muted-foreground">
              Aucune intervention pour le moment. Publiez la première.
            </p>
          ) : (
            <ol className="divide-y divide-border space-y-4">
              {updates.map((update) => (
                <li key={update.id} className="flex gap-3 p-4 rounded-lg border border-border bg-card">
                  <span className="shrink-0 w-14 text-sm font-bold tabular-nums text-editorial-link">
                    {update.minute != null ? `${update.minute}′` : "—"}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {update.type}
                      </span>
                      {update.isPinned && (
                        <span className="text-xs font-bold rounded bg-accent px-2 py-0.5 text-neutral-900">
                          Épinglé
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Par {update.author.name ?? "auteur inconnu"}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">
                      {update.content}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {update.createdAt.toLocaleString("fr-FR", {
                        weekday: "short",
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
