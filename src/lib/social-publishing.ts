import { prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo";
import {
  facebookPublishingConfigured,
  instagramPublishingConfigured,
  publishFacebookPost,
  publishInstagramPost,
} from "@/lib/social-platforms";

/**
 * Publication Meta depuis le serveur.
 *
 * Les articles générés depuis une source officielle sont distribués
 * automatiquement après leur publication. Les autres conservent des brouillons
 * que seule une personne autorisée peut envoyer depuis le studio.
 *
 * Aucun token n'est exposé au client : les Server Actions et la tâche `after()`
 * appellent ce module côté serveur.
 */

export type SocialPublishingAvailability = {
  facebook: boolean;
  instagram: boolean;
};

type PublishablePlatform = "FACEBOOK" | "INSTAGRAM";

type ArticleForPublishing = {
  slug: string;
  coverImageUrl: string | null;
};

export type PublishSocialPostResult = {
  externalId: string;
  alreadyPublished: boolean;
};

/** Indique au studio quels réseaux sont réellement configurés. */
export function socialPublishingAvailability(): SocialPublishingAvailability {
  return {
    facebook: facebookPublishingConfigured(),
    instagram: instagramPublishingConfigured(),
  };
}

function isJpegUrl(value: string): boolean {
  try {
    return /\.jpe?g$/i.test(new URL(value, "https://example.invalid").pathname);
  } catch {
    return false;
  }
}

/**
 * Choisit une image publique pour Instagram.
 *
 * Une couverture HTTPS déjà en JPEG est prioritaire. Sinon, la route
 * `instagram-image` reprend l'image Open Graph de l'article et la convertit en
 * JPEG, seul format accepté par l'API Meta. Cela couvre les couvertures WebP ou
 * PNG et les articles sans visuel.
 */
export function resolveSocialImageUrl(article: ArticleForPublishing): string {
  const cover = article.coverImageUrl?.trim();
  if (cover) {
    const absolute = /^https:\/\//i.test(cover)
      ? cover
      : cover.startsWith("/") || !/^[a-z][a-z0-9+.-]*:/i.test(cover)
        ? absoluteUrl(cover.startsWith("/") ? cover : `/${cover}`)
        : null;
    if (absolute && isJpegUrl(absolute)) return absolute;
  }
  return absoluteUrl(`/article/${encodeURIComponent(article.slug)}/instagram-image`);
}

function publicPublishError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Publication impossible.";
  return message
    .replace(/access_token=[^&\s]+/gi, "access_token=[masqué]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500) || "Publication impossible.";
}

function platformAvailability(platform: PublishablePlatform): boolean {
  return platform === "FACEBOOK"
    ? facebookPublishingConfigured()
    : instagramPublishingConfigured();
}

async function publishToPlatform(
  platform: PublishablePlatform,
  content: string,
  imageUrl: string,
): Promise<{ id: string }> {
  return platform === "FACEBOOK"
    ? publishFacebookPost(content)
    : publishInstagramPost(content, imageUrl);
}

/**
 * Publie un SocialPost Meta et met à jour son état.
 *
 * Le passage préalable à `PUBLISHING` évite qu'un clic et la tâche automatique
 * envoient deux fois le même post. Un état `PUBLISHING` abandonné depuis plus
 * de dix minutes peut être repris après un redémarrage du serveur.
 */
export async function publishSocialPostRecord(
  postId: string,
  options: { automatic?: boolean } = {},
): Promise<PublishSocialPostResult> {
  const post = await prisma.socialPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      platform: true,
      content: true,
      status: true,
      externalId: true,
      article: {
        select: { id: true, slug: true, coverImageUrl: true, status: true },
      },
    },
  });
  if (!post) throw new Error("Post introuvable.");
  if (post.platform !== "FACEBOOK" && post.platform !== "INSTAGRAM") {
    throw new Error("Seuls Facebook et Instagram peuvent être publiés via l'API.");
  }
  if (post.article.status !== "PUBLISHED") {
    throw new Error("L'article doit être publié avant ses posts sociaux.");
  }
  if (post.status === "POSTED") {
    return { externalId: post.externalId ?? "", alreadyPublished: true };
  }
  if (!platformAvailability(post.platform)) {
    throw new Error(
      post.platform === "FACEBOOK"
        ? "Publication Facebook non configurée : ajoutez META_FACEBOOK_TOKEN et META_FACEBOOK_PAGE_ID."
        : "Publication Instagram non configurée : ajoutez META_ACCESS_TOKEN et META_IG_USER_ID.",
    );
  }

  const staleBefore = new Date(Date.now() - 10 * 60 * 1_000);
  const claim = await prisma.socialPost.updateMany({
    where: {
      id: postId,
      OR: [
        { status: { in: ["DRAFT", "FAILED"] } },
        { status: "PUBLISHING", updatedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "PUBLISHING",
      error: null,
      ...(options.automatic ? { autoPublished: true } : {}),
    },
  });
  if (claim.count !== 1) {
    throw new Error(
      post.status === "PUBLISHING"
        ? "Cette publication est déjà en cours."
        : "Cette publication a déjà été traitée.",
    );
  }

  try {
    const imageUrl = resolveSocialImageUrl(post.article);
    const published = await publishToPlatform(post.platform, post.content, imageUrl);
    await prisma.socialPost.update({
      where: { id: postId },
      data: {
        status: "POSTED",
        externalId: published.id,
        error: null,
        publishedAt: new Date(),
      },
    });
    return { externalId: published.id, alreadyPublished: false };
  } catch (error) {
    const message = publicPublishError(error);
    try {
      await prisma.socialPost.update({
        where: { id: postId },
        data: { status: "FAILED", error: message },
      });
    } catch {
      // L'erreur de publication reste prioritaire ; l'état sera repris au
      // prochain passage si la base est momentanément indisponible.
    }
    console.error("[distribution] Publication Meta échouée", {
      platform: post.platform,
      postId,
      message,
    });
    throw new Error(message);
  }
}

/**
 * Distribue automatiquement les posts Facebook et Instagram d'un article issu
 * d'une source officielle. Les réseaux non configurés restent en brouillon :
 * aucune erreur n'est enregistrée pour un simple défaut de token.
 */
export async function autoPublishOfficialSocialPosts(
  articleId: string,
): Promise<{ attempted: number; published: number; failed: number }> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: {
      status: true,
      socialAutoPublish: true,
      socialPosts: {
        where: {
          platform: { in: ["FACEBOOK", "INSTAGRAM"] },
          status: { in: ["DRAFT", "FAILED"] },
        },
        select: { id: true, platform: true },
      },
    },
  });
  if (!article || article.status !== "PUBLISHED" || !article.socialAutoPublish) {
    return { attempted: 0, published: 0, failed: 0 };
  }

  const availability = socialPublishingAvailability();
  let attempted = 0;
  let published = 0;
  let failed = 0;

  for (const post of article.socialPosts) {
    if (post.platform === "FACEBOOK" && !availability.facebook) continue;
    if (post.platform === "INSTAGRAM" && !availability.instagram) continue;
    attempted += 1;
    try {
      await publishSocialPostRecord(post.id, { automatic: true });
      published += 1;
    } catch {
      failed += 1;
    }
  }

  return { attempted, published, failed };
}
