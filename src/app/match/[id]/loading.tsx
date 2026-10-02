/**
 * Écran de chargement d'un match (WP8c) : la fiche (équipes, score, statut) est
 * réservée à l'avance, logos compris, pour éviter tout décalage.
 */
export default function MatchLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-6 h-4 w-40 animate-pulse rounded bg-gray-100" />

      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="h-4 w-32 animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-48 animate-pulse rounded bg-gray-100" />
        <div className="h-6 w-24 animate-pulse rounded-full bg-gray-100" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white p-6">
        <div className="flex flex-1 flex-col items-center gap-3">
          <div className="h-16 w-16 animate-pulse rounded-full bg-gray-100" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
        </div>
        <div className="h-10 w-16 animate-pulse rounded bg-gray-100" />
        <div className="flex flex-1 flex-col items-center gap-3">
          <div className="h-16 w-16 animate-pulse rounded-full bg-gray-100" />
          <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    </main>
  );
}
