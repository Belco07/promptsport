import type { Metadata } from "next";
import { ArrowLeft, FileText, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleCard, type ArticleCardData } from "@/components/ArticleCard";
import { Footer } from "@/components/Footer";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody } from "@/components/ui/Card";
import { prisma } from "@/lib/prisma";
import { buildPageMetadata, jsonLdString, personJsonLd } from "@/lib/seo";

/**
 * Page auteur (WP9) — /auteur/[slug].
 *
 * Affiche la photo (ou les initiales), le nom, la biographie et les articles
 * publiés, avec un JSON-LD Person pour le référencement.
 *
 * La résolution du slug tolère les auteurs créés sans identifiant d'URL
 * (l'administration des utilisateurs ne le renseigne pas) : à défaut de
 * correspondance exacte, on compare le slug du nom. La page reste ainsi
 * accessible sans modification du backoffice.
 */
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

/** « Chloé Martin » → « chloe-martin » (même règle que le script de reprise). */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const authorSelect = {
  id: true,
  name: true,
  bio: true,
  photoUrl: true,
  slug: true,
  role: true,
} as const;

async function getAuthor(slug: string) {
  const direct = await prisma.author.findUnique({ where: { slug }, select: authorSelect });
  if (direct) {
    return direct;
  }

  // Filet de sécurité : auteur sans slug enregistré (créé depuis le backoffice).
  const candidates = await prisma.author.findMany({ select: { id: true, name: true } });
  const match = candidates.find((candidate) => slugify(candidate.name) === slug);
  if (!match) {
    return null;
  }
  return prisma.author.findUnique({ where: { id: match.id }, select: authorSelect });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const author = await getAuthor(slug);

  if (!author) {
    return { title: "Auteur introuvable" };
  }

  return buildPageMetadata({
    title: author.name,
    description:
      author.bio?.trim() ||
      `Tous les articles publiés par ${author.name} sur PromptSport.`,
    path: `/auteur/${author.slug ?? slug}`,
    images: author.photoUrl ? [author.photoUrl] : undefined,
  });
}

/** Libellé public d'un rôle interne. */
const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Direction éditoriale",
  EDITOR: "Chef de rubrique",
  JOURNALIST: "Journaliste",
};

export default async function AuthorPage({ params }: Props) {
  const { slug } = await params;
  const author = await getAuthor(slug);

  if (!author) {
    notFound();
  }

  const articles = (await prisma.article.findMany({
    where: { status: "PUBLISHED", authorId: author.id },
    orderBy: { publishedAt: "desc" },
    take: 12,
    select: {
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      publishedAt: true,
      isPremium: true,
      category: { select: { name: true } },
      author: { select: { name: true, slug: true } },
    },
  })) as ArticleCardData[];

  const path = `/auteur/${author.slug ?? slug}`;
  const initial = author.name.trim().charAt(0).toUpperCase();
  // L'optimiseur d'images n'accepte que les fichiers locaux et les domaines
  // déclarés dans next.config.ts : une photo distante est affichée telle quelle.
  const optimizable = Boolean(author.photoUrl?.startsWith("/"));

  return (
    <>
      <main id="contenu" className="mx-auto w-full max-w-5xl px-4 py-10">
        {/* Données structurées : la personne (WP9, demande du WP8a). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: jsonLdString(
              personJsonLd({
                name: author.name,
                path,
                description: author.bio,
                image: optimizable ? author.photoUrl : null,
                jobTitle: ROLE_LABELS[author.role] ?? null,
              }),
            ),
          }}
        />

        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 transition-colors hover:text-primary-900"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <header className="mb-10 border-b border-neutral-200 pb-8">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            {author.photoUrl && optimizable ? (
              <Image
                src={author.photoUrl}
                alt={`Portrait de ${author.name}`}
                width={112}
                height={112}
                sizes="112px"
                className="h-28 w-28 rounded-full object-cover"
              />
            ) : author.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- photo distante non déclarée dans next.config.ts
              <img
                src={author.photoUrl}
                alt={`Portrait de ${author.name}`}
                className="h-28 w-28 rounded-full object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-28 w-28 items-center justify-center rounded-full bg-primary-900 text-4xl font-extrabold text-white"
              >
                {initial}
              </div>
            )}

            <div className="min-w-0">
              <Badge variant="role" tone="primary">
                <User aria-hidden="true" className="h-3.5 w-3.5" />
                {ROLE_LABELS[author.role] ?? "Rédaction"}
              </Badge>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-primary-900 sm:text-4xl">
                {author.name}
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                {articles.length} article{articles.length > 1 ? "s" : ""} publié
                {articles.length > 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {author.bio?.trim() ? (
            <p className="mt-6 max-w-prose text-base leading-7 text-neutral-700">{author.bio}</p>
          ) : (
            <p className="mt-6 max-w-prose text-base leading-7 text-neutral-500">
              {author.name} n&apos;a pas encore renseigné de biographie.
            </p>
          )}
        </header>

        <section aria-labelledby="articles-auteur">
          <h2
            id="articles-auteur"
            className="mb-6 flex items-center gap-2 text-2xl font-extrabold tracking-tight text-primary-900"
          >
            <FileText aria-hidden="true" className="h-5 w-5 text-accent-500" />
            Ses articles
          </h2>

          {articles.length === 0 ? (
            <Card>
              <CardBody className="text-center text-sm text-neutral-500">
                Aucun article publié pour le moment.
              </CardBody>
            </Card>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {articles.map((article) => (
                <ArticleCard key={article.slug} article={article} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}
