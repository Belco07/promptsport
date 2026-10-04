import type { Metadata } from "next";
import { ArrowLeft, Clock, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ArticleReactions } from "@/components/ArticleReactions";
import { AdSlot } from "@/components/AdSlot";
import { AdSlotGate } from "@/components/AdSlotGate";
import { CommentsSection } from "@/components/CommentsSection";
import { Footer } from "@/components/Footer";
import { Paywall } from "@/components/Paywall";
import { PremiumBadge } from "@/components/PremiumBadge";
import { Badge } from "@/components/ui/Badge";
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
import { formatDate } from "@/lib/formatDate";
import { prisma } from "@/lib/prisma";
import { COMMENT_RATE_LIMIT, peekRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { buildPageMetadata, jsonLdString, newsArticleJsonLd } from "@/lib/seo";
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

async function getPublishedArticle(slug: string) {
  return prisma.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    include: {
      author: { select: { name: true, slug: true } },
      category: { select: { name: true, slug: true } },
    },
  });
}

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
 * Rendu Markdown (WP9) : la mise en forme vit dans `.article-body`
 * (src/app/globals.css) plutôt que dans des classes par balise. Seuls les
 * éléments qui ont besoin d'un comportement propre sont surchargés : liens
 * externes, images distantes et tableaux (défilement horizontal sur mobile).
 */
const markdownComponents = {
  a: (props: React.ComponentProps<"a">) => (
    <a target="_blank" rel="noopener noreferrer" {...props} />
  ),
  table: (props: React.ComponentProps<"table">) => (
    // Les tableaux Markdown peuvent être larges : ils défilent sur mobile.
    <div className="scroll-x my-5">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th className="border border-neutral-200 bg-neutral-100 px-3 py-2 text-left font-semibold" {...props} />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td className="border border-neutral-200 px-3 py-2" {...props} />
  ),
  img: (props: React.ComponentProps<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element -- images Markdown distantes
    <img className="my-5 w-full rounded-xl" alt="" {...props} />
  ),
  hr: () => <hr className="my-8 border-neutral-200" />,
  pre: (props: React.ComponentProps<"pre">) => (
    <pre className="scroll-x my-5 rounded-xl bg-primary-950 p-4 text-sm text-neutral-100" {...props} />
  ),
};

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
      <div className="max-w-prose">
        {/* Le teaser est du texte brut : tronquer du Markdown casserait le
            rendu (balises et emphases non fermées). */}
        <p className="whitespace-pre-line text-base leading-7 text-neutral-800">{teaser}</p>
        <Paywall isLoggedIn={Boolean(session?.user)} />
      </div>
    );
  }

  return (
    <div className="article-body max-w-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Emplacement réservé pendant le streaming du corps (aucun décalage visuel). */
function ArticleBodyFallback() {
  return (
    <div aria-hidden="true" className="max-w-prose space-y-4">
      {[0, 1, 2, 3].map((line) => (
        <div key={line} className="h-4 w-full animate-pulse rounded bg-neutral-100" />
      ))}
      <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
    </div>
  );
}

/**
 * Articles connexes : même rubrique d'abord, complétés par les dernières
 * publications.
 *
 * Présentés sous forme de liste éditoriale (rubrique, titre, date) plutôt qu'en
 * cartes illustrées : sur une page d'article, trois vignettes supplémentaires
 * pesaient ~16 Ko d'images sans bénéfice de lecture — la contrainte de poids du
 * WP9 (≤ +10 % par rapport au WP8c) a guidé ce choix.
 */
async function RelatedArticles({
  slug,
  categorySlug,
}: {
  slug: string;
  categorySlug: string | null;
}) {
  const select = {
    slug: true,
    title: true,
    publishedAt: true,
    isPremium: true,
    category: { select: { name: true } },
  } as const;

  const sameCategory = categorySlug
    ? await prisma.article.findMany({
        where: { status: "PUBLISHED", slug: { not: slug }, category: { slug: categorySlug } },
        orderBy: { publishedAt: "desc" },
        take: 3,
        select,
      })
    : [];

  // Complète avec les dernières publications si la rubrique est peu fournie.
  const filler =
    sameCategory.length < 3
      ? await prisma.article.findMany({
          where: {
            status: "PUBLISHED",
            slug: { notIn: [slug, ...sameCategory.map((item) => item.slug)] },
          },
          orderBy: { publishedAt: "desc" },
          take: 3 - sameCategory.length,
          select,
        })
      : [];

  const related = [...sameCategory, ...filler];

  if (related.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="articles-connexes" className="mt-14 border-t border-neutral-200 pt-10">
      <h2
        id="articles-connexes"
        className="mb-6 text-2xl font-extrabold tracking-tight text-primary-900"
      >
        À lire aussi
      </h2>
      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {related.map((item) => (
          <li key={item.slug}>
            <Link
              href={`/article/${item.slug}`}
              className="flex flex-col gap-1 py-4 transition-colors hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
            >
              <span className="flex min-w-0 items-center gap-2">
                {item.category ? (
                  <Badge variant="category">{item.category.name}</Badge>
                ) : null}
                {item.isPremium ? <PremiumBadge /> : null}
                <span className="min-w-0 font-semibold text-neutral-900">{item.title}</span>
              </span>
              <span className="shrink-0 text-xs text-neutral-500">
                {formatDate(item.publishedAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Messages affichés au-dessus du formulaire de commentaire : confirmation
 * d'envoi ou explication d'un refus (dont le bannissement).
 */
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
    <ArticleReactions
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
  return <div aria-hidden="true" className="h-9 w-64 animate-pulse rounded-full bg-neutral-100" />;
}

export default async function ArticlePage({ params, searchParams }: ArticlePageProps) {
  const { slug } = await params;
  const article = await getPublishedArticle(slug);

  if (!article) {
    notFound();
  }

  const minutes = readingTime(article.content);

  // État de bannissement de la personne connectée : sert à afficher le message
  // de refus à côté du formulaire, la Server Action le vérifiant de son côté.
  const session = await auth();
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
      <main id="contenu" className="mx-auto w-full max-w-3xl px-4 py-10">
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

        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 transition-colors hover:text-primary-900"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <article>
          <header className="mb-8">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {article.category ? (
                <Badge variant="category">{article.category.name}</Badge>
              ) : null}
              {article.isPremium ? <PremiumBadge /> : null}
            </div>

            <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-primary-900 sm:text-4xl lg:text-5xl">
              {article.title}
            </h1>

            {article.excerpt ? (
              <p className="mt-4 text-lg leading-8 text-neutral-600">{article.excerpt}</p>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-neutral-200 py-3 text-sm text-neutral-500">
              {article.author ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-neutral-800">
                  <User aria-hidden="true" className="h-4 w-4 text-neutral-400" />
                  {article.author.slug ? (
                    <Link
                      href={`/auteur/${article.author.slug}`}
                      className="transition-colors hover:text-primary-700"
                    >
                      {article.author.name}
                    </Link>
                  ) : (
                    article.author.name
                  )}
                </span>
              ) : null}
              {article.publishedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <time dateTime={article.publishedAt.toISOString()}>
                    {formatDate(article.publishedAt)}
                  </time>
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5">
                <Clock aria-hidden="true" className="h-4 w-4 text-neutral-400" />
                {minutes} min de lecture
              </span>
            </div>

            {/* Réactions de l'article (WP10b) : Like, Love et Bookmark privé. */}
            <div className="mt-5 border-t border-neutral-200 pt-4">
              <Suspense fallback={<ArticleReactionsFallback />}>
                <ArticleReactionsLoader
                  articleId={article.id}
                  viewerId={session?.user?.id ?? null}
                  isBanned={banned}
                />
              </Suspense>
            </div>
          </header>

          {article.coverImageUrl ? (
            // Image LCP de la page : chargée en priorité, avec des largeurs
            // adaptées à la colonne de contenu (768 px maximum utile).
            <Image
              src={article.coverImageUrl}
              alt={article.title}
              width={1200}
              height={630}
              priority
              fetchPriority="high"
              sizes="(max-width: 768px) 100vw, 800px"
              className="mb-3 h-auto w-full rounded-xl"
            />
          ) : null}
          <p className="article-caption mb-8">
            {article.category ? `${article.category.name} — ` : ""}
            {article.author?.name ?? "La rédaction"}
          </p>

          <Suspense fallback={<ArticleBodyFallback />}>
            <ArticleBody
              slug={article.slug}
              isPremium={article.isPremium}
              excerpt={article.excerpt}
            />
          </Suspense>
        </article>

        {/* Bandeau publicitaire réservé, après le corps de l'article (voir AdSlot).
            La page lit déjà la session (commentaires) : le serveur tranche, aucun
            affichage transitoire pour les abonnés. */}
        <AdSlotGate premium={session?.user?.isPremium === true}>
          <AdSlot className="mt-10" />
        </AdSlotGate>

        <Link
          href="/"
          className="mt-10 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 transition-colors hover:text-primary-900"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <Suspense fallback={null}>
          <RelatedArticles slug={article.slug} categorySlug={article.category?.slug ?? null} />
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
            isBanned={banned}
            banMessage={banMessage}
            notice={notice}
            replyTo={query.repondre ?? null}
          />
        </Suspense>
      </main>

      <Footer />
    </>
  );
}
