import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";

import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";
import { FormatFilter } from "@/components/FormatFilter";
import { ThemeHeader } from "@/components/ThemeHeader";
import type { ArticleFormat } from "@/components/FormatBadge";
import { prisma } from "@/lib/prisma";
import { buildPageMetadata, jsonLdString, itemListJsonLd } from "@/lib/seo";

/**
 * Page publique d'un thème éditorial (WP16c) — /theme/[slug].
 *
 * Affiche l'en-tête du thème, la liste paginée de ses articles publiés
 * (12 par page) et un filtre par format (`?format=FLASH`). Un thème inconnu ou
 * désactivé répond 404 : les thèmes inactifs ne doivent pas être indexables.
 *
 * La page est publique et ne lit pas la session (les cartes n'affichent que des
 * informations non réservées), elle suit donc le régime ISR des pages de
 * rubrique, comme /scores.
 */

export const revalidate = 60;

/** Articles affichés par page. */
const PAGE_SIZE = 12;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; format?: string }>;
};

const themeSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  color: true,
  icon: true,
  active: true,
} as const;

/** Numéro de page sûr : entier positif, 1 par défaut. */
function resolvePage(value?: string): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Format de filtre sûr : seules les trois valeurs de l'énumération passent. */
function resolveFormat(value?: string): ArticleFormat | undefined {
  return value === "FLASH" || value === "NEWS" || value === "ANALYSIS" ? value : undefined;
}

async function getTheme(slug: string) {
  const theme = await prisma.theme.findUnique({ where: { slug }, select: themeSelect });
  // Un thème désactivé est traité comme inexistant : sa page ne doit plus être
  // accessible ni indexée.
  return theme && theme.active ? theme : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const theme = await getTheme(slug);

  if (!theme) {
    return { title: "Thème introuvable" };
  }

  return buildPageMetadata({
    // Le gabarit du layout ajoute « | PromptSport ».
    title: theme.name,
    description:
      theme.description?.trim() ||
      `Tous les articles publiés sur le thème ${theme.name} sur PromptSport.`,
    path: `/theme/${theme.slug}`,
  });
}

export default async function ThemePage({ params, searchParams }: Props) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const theme = await getTheme(slug);

  if (!theme) {
    notFound();
  }

  const page = resolvePage(query.page);
  const format = resolveFormat(query.format);
  const where = {
    status: "PUBLISHED" as const,
    themes: { some: { id: theme.id } },
    ...(format ? { format } : {}),
  };

  const [articles, total, themeTotal] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        format: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        publishedAt: true,
        isPremium: true,
        category: { select: { name: true } },
        author: { select: { name: true, slug: true } },
      },
    }) as Promise<ArticleCardData[]>,
    prisma.article.count({ where }),
    // Total du thème, filtre non appliqué : l'en-tête annonce les deux.
    prisma.article.count({
      where: { status: "PUBLISHED", themes: { some: { id: theme.id } } },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const basePath = `/theme/${theme.slug}`;
  const querySuffix = format ? `&format=${format}` : "";

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-[1280px] px-4 py-10">
        {/* Données structurées : la liste des articles du thème. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              itemListJsonLd({
                name: `Thème ${theme.name}`,
                path: basePath,
                items: articles.map((article) => ({
                  name: article.title,
                  url: `/article/${article.slug}`,
                })),
              }),
            ),
          }}
        />

        <ThemeHeader theme={theme} articleCount={themeTotal} filteredCount={total} />

        <FormatFilter basePath={basePath} activeFormat={format} />

        {articles.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {format
              ? "Aucun article de ce format pour ce thème."
              : "Aucun article publié sur ce thème pour le moment."}
          </p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <ArticleCard
                key={article.slug}
                article={article}
                priority={index === 0}
                headingLevel={2}
              />
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <nav
            aria-label="Pagination des articles du thème"
            className="mt-10 flex items-center justify-between gap-4 border-t border-border pt-6 text-sm"
          >
            {page > 1 ? (
              <Link
                href={`${basePath}?page=${page - 1}${querySuffix}`}
                className="font-semibold text-editorial-link hover:underline"
              >
                ← Page précédente
              </Link>
            ) : (
              <span className="text-muted-foreground">← Page précédente</span>
            )}
            <span className="text-muted-foreground">
              Page {page} sur {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={`${basePath}?page=${page + 1}${querySuffix}`}
                className="font-semibold text-editorial-link hover:underline"
              >
                Page suivante →
              </Link>
            ) : (
              <span className="text-muted-foreground">Page suivante →</span>
            )}
          </nav>
        ) : null}
      </main>

      <Footer />
    </>
  );
}
