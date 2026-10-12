"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FEATURED_SLOTS, type FeaturedSlotName, type PickerArticle } from "@/lib/featured";

async function authorized() {
  const session = await auth();
  return Boolean(session?.user?.id && ["ADMIN", "EDITOR"].includes(session.user.role));
}
function validSlot(slot: string): slot is FeaturedSlotName { return (FEATURED_SLOTS as readonly string[]).includes(slot); }
function refresh() { revalidatePath("/"); revalidatePath("/studio/une"); revalidatePath("/studio/articles"); }

export async function setFeaturedSlot(slot: string, articleId: string) {
  if (!await authorized()) return { error: "Accès réservé aux administrateurs et éditeurs." };
  if (!validSlot(slot) || typeof articleId !== "string" || !articleId || articleId.length > 200) return { error: "Sélection invalide." };
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(170018)`;
    const article = await tx.article.findFirst({ where: { id: articleId, status: "PUBLISHED", publishedAt: { lte: new Date() } }, select: { id: true } });
    if (!article) return { error: "Choisissez un article actuellement publié." };
    if (slot !== "URGENT" && await tx.featuredSlot.findFirst({ where: { articleId, slot: { notIn: [slot, "URGENT"] } } })) return { error: "Cet article occupe déjà un autre emplacement de la une. Retirez-le ou choisissez un autre article." };
    await tx.featuredSlot.upsert({ where: { slot }, create: { slot, articleId, position: FEATURED_SLOTS.indexOf(slot) }, update: { articleId, position: FEATURED_SLOTS.indexOf(slot) } });
    return { success: true };
  });
  if ("success" in result) refresh();
  return result;
}

export async function clearFeaturedSlot(slot: string) {
  if (!await authorized()) return { error: "Accès réservé aux administrateurs et éditeurs." };
  if (!validSlot(slot)) return { error: "Emplacement invalide." };
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(170018)`;
    await tx.featuredSlot.deleteMany({ where: { slot } });
  });
  refresh(); return { success: true };
}

export async function swapSecondarySlots() {
  if (!await authorized()) return { error: "Accès réservé aux administrateurs et éditeurs." };
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(170018)`;
    const rows = await tx.featuredSlot.findMany({ where: { slot: { in: ["SECONDARY_1", "SECONDARY_2"] } } });
    const first = rows.find(row => row.slot === "SECONDARY_1"), second = rows.find(row => row.slot === "SECONDARY_2");
    if (!first || !second) return { error: "Choisissez les deux articles secondaires avant de les réordonner." };
    await tx.featuredSlot.update({ where: { slot: "SECONDARY_1" }, data: { articleId: second.articleId, position: 1 } });
    await tx.featuredSlot.update({ where: { slot: "SECONDARY_2" }, data: { articleId: first.articleId, position: 2 } });
    return { success: true };
  });
  if ("success" in result) refresh(); return result;
}

export async function findFeaturedArticles(query: string): Promise<{ articles: PickerArticle[]; error?: string }> {
  if (!await authorized()) return { articles: [], error: "Accès refusé." };
  if (typeof query !== "string" || query.length > 200) return { articles: [], error: "Recherche invalide." };
  const articles = await prisma.article.findMany({ where: { status: "PUBLISHED", publishedAt: { lte: new Date() }, ...(query.trim() ? { title: { contains: query.trim(), mode: "insensitive" as const } } : {}) }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 10, select: { id: true, title: true, coverImageUrl: true, publishedAt: true } });
  return { articles: articles.map(article => ({ ...article, publishedAt: article.publishedAt?.toISOString() ?? null })) };
}
