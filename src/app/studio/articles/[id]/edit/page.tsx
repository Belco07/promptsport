import Link from "next/link";
import { notFound } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allowedArticleStatuses, canEditArticle, canSetPremium, readOnlyReason } from "@/lib/roles";
import { socialPublishingAvailability } from "@/lib/social-publishing";

import { updateArticle } from "../../actions";
import { ArticleForm } from "../../ArticleForm";
import { DistributionPanel } from "@/components/studio/DistributionPanel";

export const dynamic = "force-dynamic";

/**
 * Édition d'un article.
 *
 * L'accès est refusé (lecture seule) lorsque le rôle ou l'état de l'article ne
 * le permet pas : un journaliste modifie ses propres articles, même publiés,
 * mais pas les articles archivés. La
 * Server Action applique la même règle de son côté.
 */
export default async function EditArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const session = await auth();
  const viewer = { id: session?.user?.id ?? "", role: session?.user?.role ?? null };

  const [article, categories, themes] = await Promise.all([
    prisma.article.findUnique({
      where: { id },
      include: {
        themes: { select: { id: true } },
        newsSource: { select: { name: true, isOfficial: true } },
        socialPosts: {
          select: {
            id: true,
            platform: true,
            content: true,
            status: true,
            error: true,
            externalId: true,
            autoPublished: true,
            publishedAt: true,
          },
        },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    // WP16b : thèmes actifs, plus ceux déjà associés — un thème désactivé
    // depuis reste visible et modifiable sur un article qui le porte.
    prisma.theme.findMany({
      where: { OR: [{ active: true }, { articles: { some: { id } } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, color: true, icon: true },
    }),
  ]);

  if (!article) {
    notFound();
  }

  const subject = { authorId: article.authorId, status: article.status };
  const editable = canEditArticle(viewer, subject);

  return (
    <div className="px-8 py-10">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        {editable ? "Modifier l'article" : "Consulter l'article"}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">/{article.slug}</p>

      {article.status === "PUBLISHED" && <nav aria-label="Rubriques de l’article" className="mb-6 flex gap-5 border-b border-border text-sm font-semibold">
        <Link scroll={false} href={`/studio/articles/${id}/edit`} aria-current={tab !== "diffusion" ? "page" : undefined} className={`border-b-2 px-2 py-3 ${tab !== "diffusion" ? "border-accent text-editorial-link" : "border-transparent text-muted-foreground"}`}>Article</Link>
        <Link scroll={false} href={`/studio/articles/${id}/edit?tab=diffusion`} aria-current={tab === "diffusion" ? "page" : undefined} className={`border-b-2 px-2 py-3 ${tab === "diffusion" ? "border-accent text-editorial-link" : "border-transparent text-muted-foreground"}`}>Diffusion</Link>
      </nav>}

      {article.status === "PUBLISHED" && tab === "diffusion" ? (
        <DistributionPanel
          articleId={article.id}
          posts={article.socialPosts.map((post) => ({
            ...post,
            publishedAt: post.publishedAt?.toISOString() ?? null,
          }))}
          editable={editable}
          autoPublish={article.socialAutoPublish}
          sourceName={article.newsSource?.name ?? null}
          availability={socialPublishingAvailability()}
        />
      ) : editable ? (
        // La Server Action d'édition reçoit l'identifiant en première position.
        <ArticleForm
          action={updateArticle.bind(null, article.id)}
          categories={categories}
          themes={themes}
          submitLabel="Mettre à jour"
          allowedStatuses={allowedArticleStatuses(viewer, subject)}
          // Le caractère premium est décidé par un ADMIN ou un EDITOR : la case
          // reste informative pour les autres, et la Server Action conserve la
          // valeur en base (WP11).
          canSetPremium={canSetPremium(viewer.role)}
          defaultValues={{
            format: article.format,
            title: article.title,
            slug: article.slug,
            content: article.content,
            excerpt: article.excerpt ?? "",
            coverImageUrl: article.coverImageUrl ?? "",
            categoryId: article.categoryId,
            status: article.status,
            isPremium: article.isPremium,
            themeIds: article.themes.map((theme) => theme.id),
          }}
        />
      ) : (
        <div className="max-w-2xl rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium text-foreground">
            {readOnlyReason(viewer, subject) ?? "Lecture seule"}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {article.status === "ARCHIVED"
              ? "Cet article est archivé : contactez la rédaction en chef pour le modifier."
              : "Cet article appartient à un autre auteur. Vous pouvez le lire, mais pas le modifier."}
          </p>
          <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-foreground">Titre</dt>
              <dd className="text-muted-foreground">{article.title}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Statut</dt>
              <dd className="text-muted-foreground">{article.status}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Diffusion</dt>
              <dd className="text-muted-foreground">
                {article.isPremium ? "Réservé aux abonnés (premium)" : "Accès libre"}
              </dd>
            </div>
          </dl>
          <Link
            href="/studio/articles"
            className="mt-6 inline-block text-sm font-medium text-editorial-link underline hover:text-editorial-link"
          >
            Retour à la liste des articles
          </Link>
        </div>
      )}
    </div>
  );
}
