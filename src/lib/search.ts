import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type SearchArticleOptions = {
  q: string;
  format?: string;
  /** Category and theme accept an ID or a slug. */
  category?: string;
  theme?: string;
  /** Inclusive UTC calendar dates, YYYY-MM-DD. */
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export type SearchArticle = {
  id: string; slug: string; title: string; excerpt: string | null;
  coverImageUrl: string | null; publishedAt: string; isPremium: boolean;
  format: "FLASH" | "NEWS" | "ANALYSIS"; rank: number;
  author: { id: string; name: string; slug: string | null };
  category: { id: string; name: string; slug: string };
  themes: { id: string; name: string; slug: string; color: string | null; icon: string | null }[];
};
export type SearchResults = { articles: SearchArticle[]; total: number; page: number; totalPages: number };
export class SearchValidationError extends Error {}

function dateBoundary(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new SearchValidationError(`${field} doit être une date valide au format YYYY-MM-DD.`);
  }
  return date;
}

/** Public metadata only: never select content or serialize the search vector. */
export async function searchArticles(options: SearchArticleOptions): Promise<SearchResults> {
  const q = options.q?.trim() ?? "";
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  if (q.length < 2 || q.length > 200 || !/[\p{L}\p{N}]/u.test(q)) throw new SearchValidationError("q doit contenir entre 2 et 200 caractères et au moins une lettre ou un chiffre.");
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new SearchValidationError("page doit être un entier entre 1 et 100000.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new SearchValidationError("limit doit être un entier entre 1 et 50.");
  if (options.format !== undefined && !["FLASH", "NEWS", "ANALYSIS"].includes(options.format)) throw new SearchValidationError("format doit être FLASH, NEWS ou ANALYSIS.");
  for (const field of ["category", "theme"] as const) {
    if (options[field] !== undefined && (!options[field]!.trim() || options[field]!.length > 200)) throw new SearchValidationError(`${field} doit être un identifiant ou un slug de 1 à 200 caractères.`);
  }
  const from = dateBoundary(options.from, "from");
  const to = dateBoundary(options.to, "to");
  if (from && to && from > to) throw new SearchValidationError("from doit précéder ou égaler to.");
  const clauses: Prisma.Sql[] = [Prisma.sql`a.status = 'PUBLISHED' AND a."publishedAt" <= CURRENT_TIMESTAMP`];
  if (options.format) clauses.push(Prisma.sql`a.format = ${options.format}::"ArticleFormat"`);
  if (options.category) clauses.push(Prisma.sql`(c.id = ${options.category} OR c.slug = ${options.category})`);
  if (options.theme) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "_ArticleToTheme" at JOIN "Theme" t ON t.id = at."B" WHERE at."A" = a.id AND t.active AND (t.id = ${options.theme} OR t.slug = ${options.theme}))`);
  if (from) clauses.push(Prisma.sql`a."publishedAt" >= ${from}`);
  if (to) clauses.push(Prisma.sql`a."publishedAt" < ${new Date(to.getTime() + 86400000)}`);
  // Parameterized SQL throughout. French FTS supplies ranking; single-word
  // typo matches supplement it with rank zero, after actual full-text matches.
  const fuzzy = q.length >= 4 && !/\s/.test(q) ? Prisma.sql`OR a.title %> ${q}` : Prisma.empty;
  const [result] = await prisma.$queryRaw<{ articles: SearchArticle[]; total: number }[]>(Prisma.sql`
    WITH query AS (SELECT plainto_tsquery('pg_catalog.french', ${q}) AS terms),
    matches AS MATERIALIZED (
      SELECT a.id, a."publishedAt", ts_rank(a."searchVector", query.terms) AS rank
      FROM "Article" a JOIN "Category" c ON c.id = a."categoryId" CROSS JOIN query
      WHERE ${Prisma.join(clauses, " AND ")}
        AND (a."searchVector" @@ query.terms ${fuzzy})
    ), page_rows AS (
      SELECT * FROM matches ORDER BY rank DESC, "publishedAt" DESC, id DESC
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    )
    SELECT (SELECT count(*)::integer FROM matches) AS total,
      coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'slug', a.slug, 'title', a.title, 'excerpt', a.excerpt,
        'coverImageUrl', a."coverImageUrl", 'publishedAt', a."publishedAt",
        'isPremium', a."isPremium", 'format', a.format, 'rank', p.rank,
        'author', jsonb_build_object('id', u.id, 'name', u.name, 'slug', u.slug),
        'category', jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug),
        'themes', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'color', t.color, 'icon', t.icon) ORDER BY t.name, t.id), '[]'::jsonb)
          FROM "_ArticleToTheme" at JOIN "Theme" t ON t.id = at."B" WHERE at."A" = a.id AND t.active)
      ) ORDER BY p.rank DESC, p."publishedAt" DESC, p.id DESC), '[]'::jsonb) AS articles
    FROM page_rows p JOIN "Article" a ON a.id = p.id
    JOIN "Author" u ON u.id = a."authorId" JOIN "Category" c ON c.id = a."categoryId"
  `);
  return { ...result, page, totalPages: Math.ceil(result.total / limit) };
}
