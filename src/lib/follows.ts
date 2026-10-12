import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ArticleCardData } from "@/components/ArticleCard";

/** Whole phrases prevent e.g. Inter matching Interview. No premium body is read. */
export function followTerms(subject: { name: string; shortName?: string | null }): string[] {
  return [...new Set([subject.name, subject.shortName ?? ""]
    .map(name => name.toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim())
    .filter(name => name.length >= 3))];
}

export function getReaderFollows(userId: string) {
  return prisma.author.findUnique({
    where: { id: userId },
    select: {
      followedTeams: { select: { id: true, name: true, shortName: true, slug: true }, orderBy: { name: "asc" } },
      followedCompetitions: { select: { id: true, name: true, slug: true }, orderBy: { name: "asc" } },
    },
  });
}

/** One query, up to ten published articles per followed club/competition. */
export async function getFollowedArticles(subjects: { id: string; name: string; shortName?: string | null }[]): Promise<ArticleCardData[]> {
  if (!subjects.length) return [];
  const targets = subjects.map(subject => ({ id: subject.id, terms: followTerms(subject) }));
  return prisma.$queryRaw<ArticleCardData[]>(Prisma.sql`
    SELECT DISTINCT selected.* FROM jsonb_to_recordset(${JSON.stringify(targets)}::jsonb) AS target(id text, terms jsonb)
    CROSS JOIN LATERAL (
      SELECT a.id, a.slug, a.title, a.excerpt, a."coverImageUrl", a."publishedAt", a."isPremium", a.format,
        jsonb_build_object('name', au.name, 'slug', au.slug) AS author,
        jsonb_build_object('name', c.name) AS category
      FROM "Article" a JOIN "Author" au ON au.id = a."authorId" JOIN "Category" c ON c.id = a."categoryId"
      WHERE a.status = 'PUBLISHED' AND a."publishedAt" <= NOW()
        AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(target.terms) term
          WHERE strpos(' ' || regexp_replace(lower(a.title), '[^[:alnum:]]+', ' ', 'g') || ' ', ' ' || term || ' ') > 0)
      ORDER BY a."publishedAt" DESC, a.id DESC LIMIT 10
    ) selected ORDER BY selected."publishedAt" DESC, selected.id DESC
  `);
}

/** Bulk in-app notifications only: no email helper is invoked. */
export async function notifyArticleFollowers(articleId: string): Promise<void> {
  try {
    await prisma.$transaction(async db => {
      // Serialize duplicate/concurrent publication callbacks for this article.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`article-follow:${articleId}`}))`;
      const article = await db.article.findUnique({ where: { id: articleId }, select: { title: true, slug: true, status: true, publishedAt: true, authorId: true } });
      if (!article || article.status !== "PUBLISHED" || !article.publishedAt || article.publishedAt > new Date()) return;
      const teams = await db.team.findMany({ where: { followers: { some: {} } }, select: { id: true, name: true, shortName: true } });
      const title = ` ${article.title.toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
      const ids = teams.filter(team => followTerms(team).some(term => title.includes(` ${term} `))).map(team => team.id);
      if (!ids.length) return;
      const linkUrl = `/article/${article.slug}`;
      const readers = await db.author.findMany({
        where: { id: { not: article.authorId }, followedTeams: { some: { id: { in: ids } } }, notifications: { none: { type: "ARTICLE_PUBLISHED", linkUrl } } },
        select: { id: true },
      });
      if (readers.length) await db.notification.createMany({ data: readers.map(reader => ({ userId: reader.id, type: "ARTICLE_PUBLISHED", title: "Du nouveau sur vos clubs", message: article.title.slice(0, 300), linkUrl })) });
    });
  } catch (error) {
    console.warn("[follows] Notification de publication impossible", error instanceof Error ? error.message : "Erreur inconnue");
  }
}
