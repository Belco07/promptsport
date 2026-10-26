import { prisma } from "@/lib/prisma";

export const FEATURED_SLOTS = ["HERO", "SECONDARY_1", "SECONDARY_2", "URGENT"] as const;
export type FeaturedSlotName = typeof FEATURED_SLOTS[number];
export const FEATURED_LABELS: Record<FeaturedSlotName, string> = {
  HERO: "Hero", SECONDARY_1: "Secondaire 1", SECONDARY_2: "Secondaire 2", URGENT: "Urgent",
};
export const featuredArticleSelect = {
  id: true, slug: true, title: true, excerpt: true, coverImageUrl: true,
  publishedAt: true, isPremium: true, format: true,
  author: { select: { name: true, slug: true } }, category: { select: { name: true } },
} as const;
export type PickerArticle = { id: string; title: string; coverImageUrl: string | null; publishedAt: string | null };

/** Champs strictement nécessaires au bandeau urgent. */
export const urgentArticleSelect = {
  slug: true,
  title: true,
  format: true,
  publishedAt: true,
} as const;

/** Durée d'affichage du bandeau urgent après son choix dans le studio. */
export const URGENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Article du bandeau urgent : **uniquement** celui choisi dans l'emplacement
 * URGENT du studio, et pendant 24 h après ce choix.
 *
 * Il n'y a plus de repli automatique sur le dernier FLASH ou NEWS : le bandeau
 * rouge « Urgent » est réservé aux vraies informations de dernière minute,
 * décidées par la rédaction. Un choix oublié s'éteint de lui-même ; le
 * renouveler dans le studio relance les 24 h.
 */
export async function getUrgentArticle() {
  const published = { status: "PUBLISHED" as const, publishedAt: { lte: new Date() } };

  const manual = await prisma.featuredSlot.findFirst({
    where: {
      slot: "URGENT",
      article: published,
      updatedAt: { gte: new Date(Date.now() - URGENT_MAX_AGE_MS) },
    },
    include: { article: { select: urgentArticleSelect } },
  });
  return manual?.article ?? null;
}

/** Only public metadata; unpublished or scheduled selections never reach home. */
export async function getHomepageFeatured() {
  const published = { status: "PUBLISHED" as const, publishedAt: { lte: new Date() } };
  const slots = await prisma.featuredSlot.findMany({ where: { article: published }, orderBy: [{ position: "asc" }, { slot: "asc" }], include: { article: { select: featuredArticleSelect } } });
  const manualHero = slots.find(row => row.slot === "HERO")?.article;
  const manualSecondary = slots.filter(row => row.slot === "SECONDARY_1" || row.slot === "SECONDARY_2");
  const reserved = new Set(manualSecondary.map(row => row.article.id));
  const [fallbackHero, candidates] = await Promise.all([
    manualHero ? Promise.resolve(null) : prisma.article.findFirst({ where: { ...published, id: { notIn: [...reserved] }, coverImageUrl: { not: null }, NOT: { coverImageUrl: "" } }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], select: featuredArticleSelect }),
    prisma.article.findMany({ where: published, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 5, select: featuredArticleSelect }),
  ]);
  // Reserve manual choices before assigning fallbacks, so a fallback cannot
  // duplicate an explicitly chosen secondary.
  const hero = manualHero ?? fallbackHero;
  const used = new Set(hero ? [hero.id] : []);
  const secondary = (["SECONDARY_1", "SECONDARY_2"] as const).flatMap(slot => {
    const manual = manualSecondary.find(row => row.slot === slot)?.article;
    const article = manual && !used.has(manual.id) ? manual : candidates.find(item => !used.has(item.id) && !reserved.has(item.id));
    if (!article) return [];
    used.add(article.id);
    return [article];
  });
  return { articles: hero ? [hero, ...secondary] : [], urgent: slots.find(row => row.slot === "URGENT")?.article ?? null };
}
