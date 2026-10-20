import { prisma } from "@/lib/prisma";
import { generateSocialPost } from "@/lib/ai";
import { absoluteUrl } from "@/lib/seo";

/** Rejouable et indépendant de la publication. Les posts existants restent intacts. */
export async function generateArticleSocialPosts(articleId: string): Promise<boolean> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    select: { title: true, excerpt: true, slug: true, status: true, socialPosts: { select: { platform: true } } },
  });
  if (!article || article.status !== "PUBLISHED") return false;
  const platforms = (["X", "FACEBOOK"] as const).filter(platform => !article.socialPosts.some(post => post.platform === platform));
  const results = await Promise.allSettled(platforms.map(async platform => {
    const text = await generateSocialPost(article.title, article.excerpt, platform);
    // Vérifier à nouveau le statut après l'appel distant, avant toute insertion.
    await prisma.$transaction(async tx => {
      const current = await tx.article.findUnique({ where: { id: articleId }, select: { status: true, slug: true } });
      if (current?.status !== "PUBLISHED") return;
      await tx.socialPost.upsert({
        where: { articleId_platform: { articleId, platform } },
        create: { articleId, platform, content: `${text}\n\n${absoluteUrl(`/article/${current.slug}`)}` },
        update: {},
      });
    });
  }));
  if (results.some(result => result.status === "rejected")) {
    console.error("[distribution] Génération incomplète ; relance disponible dans le studio.");
    return false;
  }
  return true;
}
