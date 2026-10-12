/**
 * Écran de chargement d'un match (WP8c) : la fiche (équipes, score, statut) est
 * réservée à l'avance, logos compris, pour éviter tout décalage.
 */
export default function MatchLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6 h-4 w-40 animate-pulse rounded bg-muted" />

      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-6">
        <div className="flex flex-1 flex-col items-center gap-3">
          <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-10 w-16 animate-pulse rounded bg-muted" />
        <div className="flex flex-1 flex-col items-center gap-3">
          <div className="h-16 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </main>
  );
}
