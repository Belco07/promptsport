"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessStudio, canEditArticle } from "@/lib/roles";
import { generateArticleSocialPosts } from "@/lib/distribution";

async function requireEditablePublishedArticle(articleId: string) {
  const session = await auth();
  if (!session?.user?.id || !canAccessStudio(session.user.role)) return false;
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { authorId: true, status: true } });
  return Boolean(article?.status === "PUBLISHED" && canEditArticle({ id: session.user.id, role: session.user.role }, article));
}

export async function retrySocialPosts(articleId: string): Promise<{ error?: string }> {
  if (!await requireEditablePublishedArticle(articleId)) return { error: "Action non autorisée." };
  try {
    const complete = await generateArticleSocialPosts(articleId);
    revalidatePath(`/studio/articles/${articleId}/edit`);
    return complete ? {} : { error: "Génération incomplète. Vérifiez la configuration IA puis réessayez." };
  } catch {
    return { error: "La génération est indisponible. Réessayez plus tard." };
  }
}

export async function markSocialPostPosted(articleId: string, postId: string): Promise<{ error?: string }> {
  if (!await requireEditablePublishedArticle(articleId)) return { error: "Action non autorisée." };
  const result = await prisma.socialPost.updateMany({ where: { id: postId, articleId }, data: { status: "POSTED" } });
  if (!result.count) return { error: "Post introuvable." };
  revalidatePath(`/studio/articles/${articleId}/edit`);
  return {};
}
