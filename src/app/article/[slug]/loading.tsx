/**
 * Écran de chargement de la page article (WP8c).
 *
 * Il reprend la structure de la page réelle (largeurs de titre, image de
 * couverture au bon ratio, lignes de texte) : l'espace est déjà réservé quand le
 * contenu arrive, donc aucun décalage de mise en page.
 */
export default function ArticleLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="mb-8 h-4 w-40 animate-pulse rounded bg-gray-100" />

      <div className="mb-3 h-6 w-24 animate-pulse rounded-full bg-gray-100" />
      <div className="mb-3 h-9 w-full animate-pulse rounded bg-gray-100" />
      <div className="mb-8 h-4 w-56 animate-pulse rounded bg-gray-100" />

      <div className="mb-8 aspect-[1200/630] w-full animate-pulse rounded-lg bg-gray-100" />

      <div className="space-y-4">
        {[0, 1, 2, 3, 4, 5].map((line) => (
          <div key={line} className="h-4 w-full animate-pulse rounded bg-gray-100" />
        ))}
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
      </div>
    </main>
  );
}
