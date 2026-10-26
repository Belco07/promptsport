import { BookmarkButton } from "@/components/BookmarkButton";
import { recordView } from "./actions";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FormatBadge } from "@/components/FormatBadge";
import { ArrowLeft } from "@/components/icons";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { MatchCard } from "@/components/MatchCard";

import { ArticleHero } from "@/components/ArticleHero";
import { ArticleMeta } from "@/components/ArticleMeta";
import { ArticleAuthorBox, ArticlePrevNext, ArticleTagsBar } from "@/components/ArticleEndMatter";
import { ArticleShareLinks } from "@/components/ArticleShareLinks";
import { ArticleReactionBars } from "@/components/ShareButtons";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { RelatedArticles } from "@/components/RelatedArticles";
import { AdSlot } from "@/components/AdSlot";
import { ADS_ENABLED } from "@/lib/ads";
import { AdSlotGate } from "@/components/AdSlotGate";
import { CommentsSection } from "@/components/CommentsSection";
import { Footer } from "@/components/Footer";
import { Paywall } from "@/components/Paywall";
import { auth } from "@/lib/auth";
import {
  COMMENT_MAX_LENGTH,
  bannedCommentMessage,
  isBanned,
  isReactionType,
  resolveCommentSort,
  resolveCommentsPage,
  type ReactionCounts,
  type ReactionType,
} from "@/lib/engagement";
import { countUniqueArticleReaders, NEWSROOM_ROLES } from "@/lib/analytics";
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";
import { COMMENT_RATE_LIMIT, peekRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { buildPageMetadata, jsonLdString, newsArticleJsonLd, sportsEventJsonLd } from "@/lib/seo";
import { hasActiveSubscription } from "@/lib/subscription";

/**
 * Le contenu rendu dépend de l'abonné : la page ne peut plus être mise en cache
 * statiquement (elle utilisait `revalidate = 60` avant le WP7c).
 */
export const dynamic = "force-dynamic";

/** Nombre de caractères visibles d'un article premium pour un non-abonné. */
const PREMIUM_TEASER_LENGTH = 200;

type ArticlePageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    commentaire?: string;
    commentsPage?: string;
    commentsSort?: string;
    /** Commentaire auquel on répond (WP10d). */
    repondre?: string;
  }>;
};

const getPublishedArticle = cache(async (slug: string) => {
  return prisma.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: {
      match: { include: { homeTeam: { select: { name: true, shortName: true, logoUrl: true } }, awayTeam: { select: { name: true, shortName: true, logoUrl: true } }, competition: { select: { name: true } } } },
      author: { select: { name: true, slug: true, photoUrl: true, bio: true } },
      category: { select: { name: true, slug: true } },
      // WP16b : thèmes éditoriaux affichés à côté de la catégorie.
      themes: { where: { active: true }, orderBy: { name: "asc" }, select: { name: true, slug: true, color: true } },
    },
  });
});

/**
 * Description SEO d'un article : extrait, sinon 160 premiers caractères du
 * contenu. La longueur est plafonnée à 200 caractères : une accroche rédigée
 * longuement (c'est arrivé) produisait une description XML/JSON-LD que les
 * moteurs tronqueraient de toute façon.
 */
function articleDescription(article: { excerpt: string | null; content: string }): string {
  const excerpt = article.excerpt?.trim();
  const text = excerpt && excerpt.length > 0 ? excerpt : article.content.slice(0, 160);
  return text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text;
}

/**
 * Temps de lecture estimé (200 mots/minute). Calculé sur le contenu réel, il
 * n'est qu'une indication : aucune donnée sensible n'est révélée (le texte d'un
 * article verrouillé n'est jamais rendu ni transmis).
 */
function readingTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);

  if (!article) {
    return { title: "Article introuvable" };
  }

  return buildPageMetadata({
    title: article.title,
    description: articleDescription(article),
    path: `/article/${article.slug}`,
    type: "article",
    // Couverture de l'article, sinon son image Open Graph dynamique.
    images: [article.coverImageUrl ?? `/article/${article.slug}/opengraph-image`],
    publishedTime: article.publishedAt?.toISOString(),
    authors: article.author ? [article.author.name] : undefined,
    section: article.category?.name,
  });
}

/**
 * Le rendu Markdown vit désormais dans `MarkdownRenderer` (WP15d), partagé avec
 * l'aperçu de l'éditeur : la page publique et l'aperçu affichent donc
 * exactement le même résultat (citations enrichies, embeds sociaux, tableaux).
 */

/**
 * Corps de l'article (WP8c) : il porte les parties coûteuses — lecture de la
 * session, contrôle de l'abonnement, rendu du Markdown — et il est streamé dans
 * un `<Suspense>`. Le navigateur reçoit donc immédiatement le titre et l'image
 * de couverture (LCP) pendant que le corps se prépare.
 */
async function ArticleBody({
  slug,
  isPremium,
  excerpt,
}: {
  slug: string;
  isPremium: boolean;
  excerpt: string | null;
}) {
  const session = await auth();

  // Le contenu est relu ici plutôt que passé en propriété : sérialiser
  // l'article dans la charge RSC (nécessaire au streaming) exposerait le texte
  // intégral d'un article premium, même verrouillé.
  const row = await prisma.article.findUnique({
    where: { slug },
    select: { content: true },
  });
  const content = row?.content ?? "";

  // Un article premium n'est déverrouillé que par un abonnement actif : un
  // visiteur, un lecteur connecté sans abonnement, ou un abonnement CANCELED ou
  // EXPIRED voient le paywall.
  const isLocked =
    isPremium &&
    !(session?.user?.id ? await hasActiveSubscription(session.user.id) : false);

  if (isLocked) {
    // Teaser : l'extrait s'il existe, sinon les premiers caractères du contenu.
    const teaser = excerpt?.trim() || `${content.slice(0, PREMIUM_TEASER_LENGTH)}…`;

    return (
      <div className="max-w-none">
        {/* Le teaser est du texte brut : tronquer du Markdown casserait le
            rendu (balises et emphases non fermées). */}
        <p className="whitespace-pre-line text-base leading-7 text-foreground">{teaser}</p>
        <Paywall isLoggedIn={Boolean(session?.user)} />
      </div>
    );
  }

  return (
    <MarkdownRenderer
      markdown={content}
      className="article-body !max-w-none !text-lg !leading-[1.7] md:!text-xl [&_p]:!leading-[1.7]"
    />
  );
}

/** Emplacement réservé pendant le streaming du corps (aucun décalage visuel). */
function ArticleBodyFallback() {
  return (
    <div aria-hidden="true" className="max-w-prose space-y-4">
      {[0, 1, 2, 3].map((line) => (
        <div key={line} className="h-4 w-full animate-pulse rounded bg-muted" />
      ))}
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
    </div>
  );
}

type CommentNotice = { type: "success" | "error"; text: string } | null;

function buildCommentNotice(
  code: string | undefined,
  ban: { bannedUntil: Date | null; banReason: string | null } | null,
  rateLimitText: string,
): CommentNotice {
  if (!code) return null;

  if (code === "limite") {
    // Le texte est calculé par la page à partir du compteur (temps restant réel).
    return { type: "error", text: rateLimitText };
  }

  if (code === "en-attente") {
    return {
      type: "success",
      text: "Votre commentaire a été envoyé. Il sera publié après validation par la modération.",
    };
  }
  if (code === "banni") {
    return {
      type: "error",
      text: bannedCommentMessage(ban?.banReason ?? null, formatDate(ban?.bannedUntil ?? null)),
    };
  }
  if (code === "vide") {
    return { type: "error", text: "Votre commentaire est vide." };
  }
  if (code === "long") {
    return {
      type: "error",
      text: `Votre commentaire dépasse ${COMMENT_MAX_LENGTH} caractères.`,
    };
  }
  if (code === "introuvable") {
    return { type: "error", text: "Cet article n'accepte pas de commentaire." };
  }
  return null;
}

/**
 * Barre de réactions de l'article (WP10b), sous le titre.
 *
 * Chargée dans son propre Suspense : la requête de comptage ne retarde ni le
 * titre ni l'image de couverture, qui reste l'élément LCP de la page.
 */
async function ArticleReactionsLoader({
  articleId,
  viewerId,
  isBanned: banned,
}: {
  articleId: string;
  viewerId: string | null;
  isBanned: boolean;
}) {
  const [grouped, mine] = await Promise.all([
    prisma.articleReaction.groupBy({
      by: ["type"],
      where: { articleId },
      _count: { _all: true },
    }),
    viewerId
      ? prisma.articleReaction.findUnique({
          where: { articleId_authorId: { articleId, authorId: viewerId } },
          select: { type: true },
        })
      : Promise.resolve(null),
  ]);

  const counts: ReactionCounts = {};
  for (const group of grouped) {
    if (isReactionType(group.type)) {
      counts[group.type] = group._count._all;
    }
  }

  const mineType: ReactionType | null = mine && isReactionType(mine.type) ? mine.type : null;

  return (
    <ArticleReactionBars
      articleId={articleId}
      initialCounts={counts}
      initialMine={mineType}
      canReact={Boolean(viewerId) && !banned}
      disabledReason={
        viewerId ? "Votre compte est temporairement banni" : "Connectez-vous pour réagir"
      }
    />
  );
}

/** Emplacement réservé de la barre de réactions pendant son chargement. */
function ArticleReactionsFallback() {
  return <div aria-hidden="true" className="h-9 w-64 animate-pulse rounded-full bg-muted" />;
}

export default async function ArticlePage({ params, searchParams }: ArticlePageProps) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);

  if (!article) {
    notFound();
  }

  const minutes = readingTime(article.content);

  // Nombre de commentaires « actifs » (approuvés, donc visibles publiquement) :
  // affiché sur le rail de partage, à gauche de l'article.
  const activeComments = await prisma.comment.count({
    where: { articleId: article.id, status: "APPROVED" },
  });

  // État de bannissement de la personne connectée : sert à afficher le message
  // de refus à côté du formulaire, la Server Action le vérifiant de son côté.
  const session = await auth();
  if (session?.user?.id) await recordView(article.id);
  // Lecteurs uniques : calculés et rendus uniquement pour la rédaction
  // (journaliste, éditeur, admin) ; jamais présents dans la page d'un lecteur.
  const isNewsroom = (NEWSROOM_ROLES as readonly string[]).includes(session?.user?.role ?? "");
  const uniqueReaders = isNewsroom ? await countUniqueArticleReaders(article.id) : undefined;
  const bookmark = session?.user?.id ? await prisma.bookmark.findUnique({ where: { readerId_articleId: { readerId: session.user.id, articleId: article.id } }, select: { id: true } }) : null;
  const ban = session?.user?.id
    ? await prisma.author.findUnique({
        where: { id: session.user.id },
        select: { bannedUntil: true, banReason: true },
      })
    : null;
  const query = await searchParams;
  const banned = Boolean(ban && isBanned(ban));
  const banMessage = bannedCommentMessage(ban?.banReason ?? null, formatDate(ban?.bannedUntil ?? null));
  const rateLimit = session?.user?.id
    ? peekRateLimit(`comment:${session.user.id}`, COMMENT_RATE_LIMIT)
    : null;
  const notice = buildCommentNotice(
    query.commentaire,
    ban,
    rateLimitMessage(rateLimit?.retryAfterMs ?? 0, COMMENT_RATE_LIMIT),
  );
  const commentSort = resolveCommentSort(query.commentsSort);
  const commentsPage = resolveCommentsPage(query.commentsPage);

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-[1280px] px-4 py-8 lg:px-5">
        {/* Données structurées NewsArticle (WP8a). Le contenu premium n'y figure
            pas : seuls le titre, l'accroche et des métadonnées publiques. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              newsArticleJsonLd({
                title: article.title,
                description: articleDescription(article),
                path: `/article/${article.slug}`,
                images: [article.coverImageUrl ?? `/article/${article.slug}/opengraph-image`],
                publishedAt: article.publishedAt?.toISOString() ?? null,
                updatedAt: article.updatedAt.toISOString(),
                authorName: article.author?.name ?? null,
                section: article.category?.name ?? null,
              }),
            ),
          }}
        />

        <Breadcrumbs items={[{ label: "Actualités", href: "/archives" }, ...(article.category ? [{ label: article.category.name, href: `/archives?category=${encodeURIComponent(article.category.slug)}` }] : []), { label: article.title, href: `/article/${article.slug}` }]} />

        <article>
          {article.match && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(sportsEventJsonLd({
            name: `${article.match.homeTeam.name} vs ${article.match.awayTeam.name}`,
            path: `/match/${article.match.id}`, startDate: article.match.scheduledAt.toISOString(),
            venue: article.match.venue, homeTeam: article.match.homeTeam.name, awayTeam: article.match.awayTeam.name,
            competitionName: article.match.competition.name, status: article.match.status,
            description: article.match.homeScore !== null && article.match.awayScore !== null ? `${article.match.homeTeam.name} ${article.match.homeScore} - ${article.match.awayScore} ${article.match.awayTeam.name}` : undefined,
          })) }} />}
          {/* Disposition « Digital Haven » : en-tête pleine largeur (catégorie,
              titre, accroche), puis colonne de lecture et colonne latérale. */}
          <ArticleHero
            title={article.title}
            excerpt={article.excerpt}
            premium={article.isPremium}
            category={article.category}
            badges={<FormatBadge format={article.format} />}
            actions={<BookmarkButton articleId={article.id} articleSlug={article.slug} initial={session?.user?.id ? { id: article.id, slug: article.slug, saved: !!bookmark } : null} showLabel />}
          />
          <div className={`mt-8 ${session?.user?.isPremium === true || !ADS_ENABLED ? "mx-auto max-w-[820px]" : "lg:grid lg:grid-cols-[minmax(0,820px)_300px] lg:justify-between lg:gap-12"}`}>
          <div className="w-full min-w-0 max-w-[820px]">
            <ArticleMeta author={article.author} date={article.publishedAt} updatedAt={article.updatedAt} minutes={minutes} uniqueReaders={uniqueReaders}>
              <ArticleShareLinks slug={article.slug} title={article.title} orientation="compact" />
            </ArticleMeta>
            {article.coverImageUrl && (
              <figure className="mt-5">
                <div className="relative aspect-video overflow-hidden rounded-[13px] bg-muted">
                  <Image src={article.coverImageUrl} alt="" fill priority sizes="(max-width: 1024px) 100vw, 820px" className="object-cover" />
                </div>
                {article.coverImageCredit ? (
                  <figcaption className="mt-2 text-xs text-muted-foreground">
                    Photo :{" "}
                    {article.coverImageCreditUrl ? (
                      <a
                        href={article.coverImageCreditUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        {article.coverImageCredit}
                      </a>
                    ) : (
                      article.coverImageCredit
                    )}
                  </figcaption>
                ) : null}
              </figure>
            )}
            {article.match && <section aria-labelledby="article-match-title" className="mt-8 rounded-lg border border-border bg-card p-4"><h2 id="article-match-title" className="mb-3 text-lg font-bold text-foreground">Match associé</h2><p className="mb-3 text-sm text-muted-foreground">{new Date(article.match.scheduledAt).toLocaleString("fr-FR", { timeZone: "Africa/Lagos", dateStyle: "long", timeStyle: "short" })}</p><MatchCard match={article.match} /><Link href={`/match/${article.match.id}`} className="mt-3 inline-block text-sm font-semibold text-editorial-link underline">Voir la fiche du match</Link></section>}
            {/*
              Rail de partage et corps de l'article sont frères dans cette ligne :
              le rail commence donc exactement à la première ligne du corps, sans
              marge calculée à la main. `[&>*:first-child]:mt-0` annule la marge
              haute du premier paragraphe, pour que l'alignement soit réel et non
              approximatif. Le rail est masqué sous 1280 px (marge insuffisante).
            */}
            <div className="mt-8 flex gap-5">
              <div className="hidden w-12 shrink-0 xl:block">
                {/* `top-32` : l'en-tête public est collant (82 px) — on garde une
                    quarantaine de pixels d'air pour que le rail ne s'y coince pas. */}
                <div className="sticky top-32">
                  <ArticleShareLinks
                    slug={article.slug}
                    title={article.title}
                    orientation="rail"
                    comments={{ count: activeComments }}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1 [&>*:first-child]:mt-0">
                <Suspense fallback={<ArticleBodyFallback />}>
                  <ArticleBody
                    slug={article.slug}
                    isPremium={article.isPremium}
                    excerpt={article.excerpt}
                  />
                </Suspense>
                {/* Fin d'article : uniquement les réactions (pouce, cœur,
                    enregistrement). Le partage reste porté par le rail, qui suit
                    la lecture jusqu'en bas. */}
                <div id="article-reactions-bottom" className="mt-8 border-y border-border py-5" aria-label="Réactions en fin d’article">
                  <Suspense fallback={<ArticleReactionsFallback />}>
                    <ArticleReactionsLoader articleId={article.id} viewerId={session?.user?.id ?? null} isBanned={banned} />
                  </Suspense>
                </div>
              </div>
            </div>

            {/* Fin d'article, dans l'ordre de la référence : tags, partage,
                auteur, article précédent / suivant, puis commentaires. */}
            <ArticleTagsBar themes={article.themes} />
            <section aria-label="Partager cet article" className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
              <h2 className="text-lg font-black text-foreground">Partager cet article</h2>
              <ArticleShareLinks slug={article.slug} title={article.title} orientation="compact" />
            </section>
            <div className="mt-5">
              <ArticleAuthorBox author={article.author} />
            </div>
            <Suspense fallback={null}>
              <ArticlePrevNext id={article.id} publishedAt={article.publishedAt} />
            </Suspense>

            {/* Commentaires publics (WP10b/WP10c) : seuls les commentaires approuvés
                sont visibles ; un auteur banni ne peut ni commenter ni réagir. */}
            <Suspense fallback={null}>
              <CommentsSection
                articleId={article.id}
                slug={article.slug}
                sort={commentSort}
                page={commentsPage}
                viewerId={session?.user?.id ?? null}
                viewerName={session?.user?.name ?? null}
                isBanned={banned}
                banMessage={banMessage}
                notice={notice}
                replyTo={query.repondre ?? null}
                defaultOpen={Boolean(query.commentaire || query.repondre || query.commentsSort || query.commentsPage)}
              />
            </Suspense>

            <Link
              href="/"
              className="mt-10 inline-flex items-center gap-1.5 text-sm font-semibold text-editorial-link transition-colors hover:text-editorial-link"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Retour à l&apos;accueil
            </Link>
          </div>
          <AdSlotGate premium={session?.user?.isPremium === true}>
            <div className="hidden lg:block">
              <AdSlot format="skyscraper" className="sticky top-40" />
            </div>
          </AdSlotGate>
          </div>
        </article>

        <Suspense fallback={null}>
          <RelatedArticles slug={article.slug} categorySlug={article.category?.slug ?? null} />
        </Suspense>
      </main>

      <Footer />
    </>
  );
}
