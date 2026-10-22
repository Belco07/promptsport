"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessStudio, canEditArticle } from "@/lib/roles";
import { distributeArticleSocialPosts } from "@/lib/distribution";
import { publishSocialPostRecord } from "@/lib/social-publishing";

async function requireEditablePublishedArticle(articleId: string) {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) return false;
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { authorId: true, status: true } });
  return Boolean(article?.status === "PUBLISHED" && canEditArticle({ id: session.user.id, role: session.user.role }, article));
}

export async function retrySocialPosts(articleId: string): Promise<{ error?: string }> {
  if (!await requireEditablePublishedArticle(articleId)) return { error: "Action non autorisée." };
  try {
    const complete = await distributeArticleSocialPosts(articleId);
    revalidatePath(`/studio/articles/${articleId}/edit`);
    return complete ? {} : { error: "Génération incomplète. Vérifiez la configuration IA puis réessayez." };
  } catch {
    return { error: "La génération est indisponible. Réessayez plus tard." };
  }
}

/** Envoie un post Facebook ou Instagram via l'API Meta, après validation humaine. */
export async function publishSocialPostNow(articleId: string, postId: string): Promise<{ error?: string }> {
  if (!await requireEditablePublishedArticle(articleId)) return { error: "Action non autorisée." };
  const post = await prisma.socialPost.findFirst({
    where: { id: postId, articleId },
    select: { platform: true },
  });
  if (!post) return { error: "Post introuvable." };
  if (post.platform !== "FACEBOOK" && post.platform !== "INSTAGRAM") {
    return { error: "Seuls Facebook et Instagram peuvent être publiés via l'API." };
  }
  try {
    await publishSocialPostRecord(postId);
    revalidatePath(`/studio/articles/${articleId}/edit`);
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error.message : "La publication a échoué." };
  }
}

export async function markSocialPostPosted(articleId: string, postId: string): Promise<{ error?: string }> {
  if (!await requireEditablePublishedArticle(articleId)) return { error: "Action non autorisée." };
  const result = await prisma.socialPost.updateMany({
    where: { id: postId, articleId, status: { not: "POSTED" } },
    data: { status: "POSTED", publishedAt: new Date(), error: null },
  });
  if (!result.count) return { error: "Post introuvable." };
  revalidatePath(`/studio/articles/${articleId}/edit`);
  return {};
}
