import { prisma } from "@/lib/prisma";
import { generateSocialPost } from "@/lib/ai";
import { absoluteUrl } from "@/lib/seo";
import { autoPublishOfficialSocialPosts } from "@/lib/social-publishing";
import { randomUUID } from "node:crypto";

/** Réseaux pris en charge par la génération de textes. */
const SOCIAL_PLATFORMS = ["X", "FACEBOOK", "INSTAGRAM"] as const;

/** Rejouable et indépendant de la publication. Les posts existants restent intacts. */
export async function generateArticleSocialPosts(articleId: string): Promise<boolean> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, excerpt: true, slug: true, status: true, socialPosts: { select: { platform: true } } },
  });
  if (!article || article.status !== "PUBLISHED") return false;
  const platforms = SOCIAL_PLATFORMS.filter(platform => !article.socialPosts.some(post => post.platform === platform));
  const results = await Promise.allSettled(platforms.map(async platform => {
    const text = await generateSocialPost(article.title, article.excerpt, platform);
    // Une seule instruction : statut et slug courants, sans transaction
    // interactive susceptible d'expirer (P2028) après une reprise de connexion.
    await prisma.$executeRaw`
      INSERT INTO "SocialPost" ("id", "articleId", "platform", "content")
      SELECT ${randomUUID()}, a."id", ${platform}::"SocialPlatform",
        ${text} || E'\\n\\n' || ${absoluteUrl("/article/")} || a."slug"
      FROM "Article" a
      WHERE a."id" = ${articleId} AND a."status" = 'PUBLISHED'
      ON CONFLICT ("articleId", "platform") DO NOTHING
    `;
  }));
  results.forEach((result, index) => {
    if (result.status !== "rejected") return;
    const error = result.reason as { name?: unknown; code?: unknown; status?: unknown } | null;
    console.error("[distribution] Échec du post", {
      platform: platforms[index],
      name: typeof error?.name === "string" ? error.name : "Error",
      code: typeof error?.code === "string" && /^[a-z0-9_]{1,40}$/i.test(error.code) ? error.code : undefined,
      status: typeof error?.status === "number" ? error.status : undefined,
    });
  });
  if (results.some(result => result.status === "rejected")) {
    console.error("[distribution] Génération incomplète ; relance disponible dans le studio.");
    return false;
  }
  return true;
}

/**
 * Génère les textes manquants puis distribue les posts des articles issus
 * d'une source officielle. Les articles non officiels conservent des brouillons
 * en attente de validation humaine.
 */
export async function distributeArticleSocialPosts(articleId: string): Promise<boolean> {
  const complete = await generateArticleSocialPosts(articleId);
  await autoPublishOfficialSocialPosts(articleId);
  return complete;
}
