import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { ArchiveFilters } from "@/components/ArchiveFilters";
import { Footer } from "@/components/Footer";
import { PageBand } from "@/components/PageBand";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return { title: { absolute: "Archives | PromptSport" }, description: "Retrouvez toute l’actualité publiée sur PromptSport par sport, thème et date.", robots: { index: true, follow: true } };
}
type Option = { id: string; slug: string; name: string };
type ArchiveData = {
  _count: number;
  articles: (Omit<ArticleCardData, "publishedAt"> & { id: string; publishedAt: string })[];
  categories: Option[]; themes: Option[]; years: number[];
};

export default async function ArchivesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  let error = "";
  for (const key of ["year", "month", "category", "theme", "format", "page"]) {
    const value = raw[key];
    if (Array.isArray(value)) error = "Chaque filtre doit être fourni une seule fois.";
    else if (value?.trim()) params.set(key, value.trim());
  }
  function integer(key: string, min: number, max: number) {
    const value = params.get(key);
    if (value === null) return undefined;
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max) { error = `Le filtre ${key} est invalide.`; return undefined; }
    return number;
  }
  const year = integer("year", 1000, 9999);
  const month = integer("month", 1, 12);
  const page = integer("page", 1, 100000) ?? 1;
  const format = params.get("format");
  if (format && !["FLASH", "NEWS", "ANALYSIS"].includes(format)) error = "Le format choisi est invalide.";
  const conditions: Prisma.Sql[] = [Prisma.sql`a.status = 'PUBLISHED' AND a."publishedAt" <= CURRENT_TIMESTAMP`];
  if (year) {
    const start = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
    const end = new Date(Date.UTC(month ? year : year + 1, month ?? 0, 1));
    conditions.push(Prisma.sql`a."publishedAt" >= ${start} AND a."publishedAt" < ${end}`);
  } else if (month) conditions.push(Prisma.sql`EXTRACT(MONTH FROM a."publishedAt") = ${month}`);
  if (format && !error) conditions.push(Prisma.sql`a.format = ${format}::"ArticleFormat"`);
  for (const key of ["category", "theme"]) if ((params.get(key)?.length ?? 0) > 200) error = "Un identifiant de filtre est trop long.";
  const category = params.get("category");
  const theme = params.get("theme");
  if (category) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "Category" c WHERE c.id = a."categoryId" AND (c.id = ${category} OR c.slug = ${category}))`);
  if (theme) conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM "_ArticleToTheme" at JOIN "Theme" t ON t.id = at."B" WHERE at."A" = a.id AND t.active AND (t.id = ${theme} OR t.slug = ${theme}))`);
  if (error) conditions.push(Prisma.sql`FALSE`);
  // One database round trip for the page, _count, and all filter options.
  // Counting separately inside this statement also preserves totals on empty pages.
  const [data] = await prisma.$queryRaw<ArchiveData[]>(Prisma.sql`
    WITH matching AS MATERIALIZED (
      SELECT a.id, a."publishedAt" FROM "Article" a WHERE ${Prisma.join(conditions, " AND ")}
    ), page_rows AS (
      SELECT * FROM matching ORDER BY "publishedAt" DESC, id DESC LIMIT 20 OFFSET ${(page - 1) * 20}
    )
    SELECT (SELECT count(*)::integer FROM matching) AS "_count",
      coalesce(jsonb_agg(jsonb_build_object('id',a.id,'slug',a.slug,'title',a.title,'excerpt',a.excerpt,
        'coverImageUrl',a."coverImageUrl",'publishedAt',a."publishedAt" AT TIME ZONE 'UTC',
        'isPremium',a."isPremium",'format',a.format,
        'category',jsonb_build_object('name',c.name), 'author',jsonb_build_object('name',u.name,'slug',u.slug)
      ) ORDER BY p."publishedAt" DESC,p.id DESC),'[]'::jsonb) AS articles,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name) ORDER BY name,id),'[]'::jsonb) FROM "Category") AS categories,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'name',name) ORDER BY name,id),'[]'::jsonb) FROM "Theme" WHERE active) AS themes,
      (SELECT coalesce(jsonb_agg(y ORDER BY y DESC),'[]'::jsonb) FROM (
        SELECT DISTINCT EXTRACT(YEAR FROM "publishedAt")::integer AS y FROM "Article" WHERE status='PUBLISHED' AND "publishedAt"<=CURRENT_TIMESTAMP
      ) years) AS years
    FROM page_rows p JOIN "Article" a ON a.id=p.id
    JOIN "Category" c ON c.id=a."categoryId" JOIN "Author" u ON u.id=a."authorId"
  `);
  const totalPages = Math.ceil(data._count / 20);
  const currentYear = new Date().getUTCFullYear();
  const years = [...new Set([...data.years, ...Array.from({ length: Math.max(1, currentYear - 2024 + 1) }, (_, index) => 2024 + index), ...(year ? [year] : [])])].sort((a,b) => b-a);
  const numbers = totalPages <= 10 ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : [...new Set([1, totalPages, ...Array.from({ length: 5 }, (_, index) => Math.min(page, totalPages) - 2 + index)])].filter(value => value >= 1 && value <= totalPages).sort((a,b) => a-b);
  function href(value: number) { const next = new URLSearchParams(params); next.set("page", String(value)); return `/archives?${next}`; }
  const linkClass = "inline-flex min-h-10 min-w-10 items-center justify-center rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted";
  return <><main id="contenu" className="mx-auto max-w-[1200px] space-y-7 px-4 pb-8 md:pb-12">
    <PageBand title="Archives" description="Toute l’actualité, de la plus récente à la plus ancienne." />
    <ArchiveFilters years={years} categories={data.categories} themes={data.themes} />
    <p role="status" aria-live="polite" className="font-semibold text-foreground">{error || `${data._count} article${data._count !== 1 ? "s" : ""}`}</p>
    {data.articles.length ? <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{data.articles.map(article => <ArticleCard key={article.id} article={{ ...article, publishedAt: new Date(article.publishedAt) }} />)}</div>
      : !error && <div className="rounded-md border border-border bg-card p-6 text-foreground"><h2 className="text-xl font-bold">Aucun article sur cette page</h2><p className="mt-2 text-muted-foreground">{data._count ? "Revenez à la première page pour consulter les articles." : "Essayez une autre période ou élargissez vos filtres."}</p>{data._count > 0 && <Link href={href(1)} className="mt-3 inline-block underline">Première page</Link>}</div>}
    {totalPages > 0 && <nav aria-label="Pagination des archives" className="flex flex-wrap items-center justify-center gap-2">
      {page > 1 && <Link href={href(page - 1)} rel="prev" className={linkClass}>Précédent</Link>}
      {numbers.map((number,index) => <span key={number} className="inline-flex items-center gap-2">
        {index > 0 && number - numbers[index-1] > 1 && <span aria-hidden="true" className="px-2 text-muted-foreground">…</span>}
        <Link href={href(number)} aria-label={`Page ${number}`} aria-current={number===page ? "page" : undefined} className={`${linkClass} ${number===page ? "!border-foreground bg-foreground !text-background" : "bg-card"}`}>{number}</Link>
      </span>)}
      {page < totalPages && <Link href={href(page + 1)} rel="next" className={linkClass}>Suivant</Link>}
    </nav>}
  </main><Footer /></>;
}
