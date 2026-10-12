import { prisma } from "@/lib/prisma";
import { themeBadgeStyle } from "@/lib/themes";

/**
 * Backoffice — liste des thèmes éditoriaux (WP16a).
 *
 * Les thèmes sont transversaux aux sports : « Mercato » ou « Tactique »
 * s'appliquent à plusieurs catégories. Cette page ne fait que les lister
 * (nom, slug, nombre d'articles, actif) ; leur association aux articles se fait
 * dans le studio (WP16b) et leur affichage public dans les WP16c/WP16d.
 *
 * L'accès est déjà restreint aux ADMIN par le layout du backoffice.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Thèmes",
};

export default async function ThemesPage() {
  const themes = await prisma.theme.findMany({
    orderBy: { name: "asc" },
    include: {
      // Nombre d'articles rattachés : relation many-to-many implicite.
      _count: { select: { articles: true } },
    },
  });

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Thèmes</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
        Thèmes éditoriaux transversaux (Mercato, Tactique, Interviews…), distincts des
        catégories sportives. Ils sont créés par <code>npm run db:seed</code>.
      </p>

      {themes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Aucun thème en base. Lancez <code>npm run db:seed</code> pour créer les thèmes par défaut.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Thèmes éditoriaux</caption>
            <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Nom
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Slug
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Articles
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Actif
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {themes.map((theme) => (
                <tr key={theme.id} className="hover:bg-muted">
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center rounded px-2 py-1 text-xs font-bold uppercase tracking-wide"
                      style={themeBadgeStyle(theme.color)}
                    >
                      {theme.name}
                    </span>
                    {theme.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{theme.description}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{theme.slug}</td>
                  <td className="px-4 py-3 tabular-nums text-foreground">
                    {theme._count.articles}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        theme.active
                          ? "rounded bg-status-success px-2 py-1 text-xs font-semibold text-status-success-foreground"
                          : "rounded bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground"
                      }
                    >
                      {theme.active ? "Actif" : "Inactif"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
