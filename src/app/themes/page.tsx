import type { Metadata } from "next";

import { Footer } from "@/components/Footer";
import { ThemeCard } from "@/components/ThemeCard";
import { prisma } from "@/lib/prisma";
import { buildPageMetadata } from "@/lib/seo";
import { PageBand } from "@/components/PageBand";

/**
 * Page /themes (WP16d) — index des thèmes éditoriaux.
 *
 * Liste les thèmes actifs avec leur badge, leur description et le nombre
 * d'articles publiés. Le comptage porte sur les articles **publiés** : il
 * correspond à ce que montre la page du thème.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = buildPageMetadata({
  title: "Tous les thèmes",
  description:
    "Mercato, Tactique, Interviews, Compétitions, Blessures, Polémiques, Power Ranking, Opinion : tous les thèmes éditoriaux de PromptSport, tous sports confondus.",
  path: "/themes",
});

export default async function ThemesIndexPage() {
  const themes = await prisma.theme.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      color: true,
      icon: true,
      // Comptage filtré : seuls les articles publiés sont annoncés.
      _count: { select: { articles: { where: { status: "PUBLISHED" } } } },
    },
  });

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-[1280px] px-4 pb-10">
        <PageBand
          title="Tous les thèmes"
          description="Les thèmes éditoriaux traversent les sports : un même thème rassemble des articles de toutes les catégories."
        />

        {themes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Aucun thème actif pour le moment.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={{
                  name: theme.name,
                  slug: theme.slug,
                  description: theme.description,
                  color: theme.color,
                  icon: theme.icon,
                  articleCount: theme._count.articles,
                }}
              />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </>
  );
}
