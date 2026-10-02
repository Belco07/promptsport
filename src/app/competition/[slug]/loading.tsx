/**
 * Écran de chargement d'une compétition (WP8c) : classement et derniers
 * résultats réservés à l'avance pour éviter tout décalage.
 */
export default function CompetitionLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-6 h-4 w-40 animate-pulse rounded bg-gray-100" />
      <div className="mb-2 h-9 w-64 animate-pulse rounded bg-gray-100" />
      <div className="mb-8 h-4 w-32 animate-pulse rounded bg-gray-100" />

      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-gray-100" />
      <div className="mb-10 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {[0, 1, 2, 3, 4, 5, 6].map((row) => (
          <div
            key={row}
            className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 last:border-0"
          >
            <div className="h-4 w-6 animate-pulse rounded bg-gray-100" />
            <div className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
            <div className="h-4 w-10 animate-pulse rounded bg-gray-100" />
          </div>
        ))}
      </div>

      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-gray-100" />
      <div className="space-y-2">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-12 w-full animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    </main>
  );
}
