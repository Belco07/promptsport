import Image from "next/image";
import Link from "next/link";

import { prisma } from "@/lib/prisma";

/**
 * Blocs de fin d'article, disposés comme la référence « Digital Haven » :
 * barre de tags, encadré auteur, puis navigation article précédent / suivant.
 * Chaque bloc est séparé du suivant par un filet.
 */

export function ArticleTagsBar({ themes }: { themes: { name: string; slug: string }[] }) {
  if (themes.length === 0) return null;
  return (
    <div className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold uppercase tracking-[1px]">
      <span className="text-muted-foreground">Tags :</span>
      {themes.map((theme) => (
        <Link key={theme.slug} href={`/theme/${theme.slug}`} className="text-foreground hover:text-editorial-link">
          {theme.name}
        </Link>
      ))}
    </div>
  );
}

export function ArticleAuthorBox({
  author,
}: {
  author: { name: string; slug: string | null; photoUrl: string | null; bio: string | null };
}) {
  return (
    <section aria-label="Auteur de l’article" className="flex gap-5 border-t border-border py-9">
      {author.photoUrl ? (
        <Image src={author.photoUrl} alt="" width={80} height={80} loading="lazy" className="h-20 w-20 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-black text-foreground">
          {author.name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Par</p>
        <p className="text-lg font-black text-foreground">
          {author.slug ? <Link href={`/auteur/${author.slug}`} className="hover:underline">{author.name}</Link> : author.name}
        </p>
        {author.bio && <p className="mt-2 text-sm leading-6 text-muted-foreground">{author.bio}</p>}
      </div>
    </section>
  );
}

/** Articles publiés juste avant et juste après celui-ci. */
export async function ArticlePrevNext({ id, publishedAt }: { id: string; publishedAt: Date | null }) {
  if (!publishedAt) return null;
  const select = { slug: true, title: true } as const;
  const [previous, next] = await Promise.all([
    prisma.article.findFirst({
      where: { status: "PUBLISHED", id: { not: id }, publishedAt: { lt: publishedAt } },
      orderBy: { publishedAt: "desc" },
      select,
    }),
    prisma.article.findFirst({
      where: { status: "PUBLISHED", id: { not: id }, publishedAt: { gt: publishedAt, lte: new Date() } },
      orderBy: { publishedAt: "asc" },
      select,
    }),
  ]);
  if (!previous && !next) return null;
  return (
    <nav aria-label="Articles précédent et suivant" className="grid gap-6 border-t border-border py-9 sm:grid-cols-2">
      <div>
        {previous && (
          <Link href={`/article/${previous.slug}`} className="group block">
            <span className="text-[11px] font-semibold uppercase tracking-[1px] text-muted-foreground">Article précédent</span>
            <span className="mt-2 block text-base font-bold leading-snug text-foreground group-hover:underline">{previous.title}</span>
          </Link>
        )}
      </div>
      <div className="sm:text-right">
        {next && (
          <Link href={`/article/${next.slug}`} className="group block">
            <span className="text-[11px] font-semibold uppercase tracking-[1px] text-muted-foreground">Article suivant</span>
            <span className="mt-2 block text-base font-bold leading-snug text-foreground group-hover:underline">{next.title}</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
