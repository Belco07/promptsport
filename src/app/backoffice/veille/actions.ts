"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { generateArticleFromAlert, isAiConfigured } from "@/lib/ai";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessBackoffice } from "@/lib/roles";
import { slugify } from "@/lib/slug";

/**
 * Server Actions du News Engine (WP41).
 *
 * Règle de sécurité : l'IA ne publie jamais. Elle produit un Markdown, puis
 * l'action crée un Article en statut DRAFT et marque l'alerte comme traitée.
 * Seule une personne peut ensuite publier depuis le studio.
 */

function veilUrl(params: { error?: string; info?: string } = {}): string {
  const search = new URLSearchParams();
  if (params.error) search.set("error", params.error.slice(0, 300));
  if (params.info) search.set("info", params.info.slice(0, 300));
  const query = search.toString();
  return `/backoffice/veille${query ? `?${query}` : ""}`;
}

function fail(message: string): never {
  redirect(veilUrl({ error: message }));
}

/** Vérifie la session et le rôle avant toute génération. */
async function requireBackofficeUser(): Promise<{ id: string }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!canAccessBackoffice(session.user.role)) redirect("/mon-compte");
  return { id: session.user.id };
}

/** Catégorie par défaut : Football si elle existe, sinon la première créée. */
async function defaultCategoryId(): Promise<string | null> {
  const football = await prisma.category.findFirst({
    where: { slug: "football" },
    select: { id: true },
  });
  if (football) return football.id;

  const first = await prisma.category.findFirst({
    orderBy: { name: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export type GenerateArticleResult = { articleId: string };

/** Crée l'article en brouillon, avec un slug unique. */
async function createDraftArticle(input: {
  title: string;
  excerpt: string;
  content: string;
  categoryId: string;
  authorId: string;
  alertId: string;
}): Promise<GenerateArticleResult> {
  const base = slugify(input.title).slice(0, 90) || `article-${Date.now()}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const article = await prisma.$transaction(async (tx) => {
        const created = await tx.article.create({
          data: {
            title: input.title,
            slug,
            content: input.content,
            excerpt: input.excerpt,
            status: "DRAFT",
            format: "NEWS",
            isPremium: false,
            publishedAt: null,
            authorId: input.authorId,
            categoryId: input.categoryId,
          },
          select: { id: true },
        });

        await tx.newsAlert.update({
          where: { id: input.alertId },
          data: { status: "DRAFT_GENERATED" },
        });

        return created;
      });

      return { articleId: article.id };
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < 4) continue;
      throw error;
    }
  }

  throw new Error("Impossible de générer un slug unique pour cet article.");
}

/**
 * Génère un brouillon à partir d'une alerte.
 *
 * L'alerte n'est marquée DRAFT_GENERATED qu'après la création réussie de
 * l'article : un échec de l'IA la laisse en PENDING pour une nouvelle tentative.
 */
export async function generateArticle(alertId: string): Promise<void> {
  const user = await requireBackofficeUser();

  if (typeof alertId !== "string" || !alertId) {
    fail("Alerte introuvable.");
  }

  if (!isAiConfigured()) {
    fail(
      "Clé IA absente : renseignez OPENAI_API_KEY (ou DEEPSEEK_API_KEY) dans .env et sur Vercel.",
    );
  }

  const alert = await prisma.newsAlert.findUnique({
    where: { id: alertId },
    include: { source: { select: { name: true } } },
  });

  if (!alert) fail("Cette alerte n'existe plus.");
  if (alert.status !== "PENDING") {
    fail("Cette alerte a déjà été traitée (brouillon généré ou ignorée).");
  }

  const categoryId = await defaultCategoryId();
  if (!categoryId) {
    fail("Aucune catégorie n'existe : créez une rubrique dans le studio avant de générer un article.");
  }

  let generated: { title: string; excerpt: string; content: string };
  try {
    generated = await generateArticleFromAlert({
      title: alert.title,
      content: alert.content,
      url: alert.url,
      sourceName: alert.source.name,
      publishedAt: alert.publishedAt,
    });
  } catch (error) {
    console.error(
      "[veille] échec de la génération IA :",
      error instanceof Error ? error.message : error,
    );
    fail(
      "La génération IA a échoué. L'alerte reste en attente ; vérifiez la clé et réessayez.",
    );
  }

  let result: GenerateArticleResult;
  try {
    result = await createDraftArticle({
      title: generated.title,
      excerpt: generated.excerpt,
      content: generated.content,
      categoryId,
      authorId: user.id,
      alertId: alert.id,
    });
  } catch (error) {
    console.error(
      "[veille] échec de la création du brouillon :",
      error instanceof Error ? error.message : error,
    );
    fail("Le brouillon n'a pas pu être créé. L'alerte reste en attente.");
  }

  revalidatePath("/backoffice/veille");
  revalidatePath("/studio/articles");
  redirect(`/studio/articles/${result.articleId}/edit`);
}

/** Marque une alerte comme ignorée (elle reste consultable dans la liste). */
export async function ignoreAlert(alertId: string): Promise<void> {
  await requireBackofficeUser();

  if (typeof alertId !== "string" || !alertId) {
    fail("Alerte introuvable.");
  }

  const updated = await prisma.newsAlert.updateMany({
    where: { id: alertId, status: "PENDING" },
    data: { status: "IGNORED" },
  });

  revalidatePath("/backoffice/veille");
  redirect(
    veilUrl({
      info: updated.count
        ? "Alerte ignorée."
        : "Cette alerte avait déjà été traitée.",
    }),
  );
}
