import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

/**
 * Garde d'existence d'un article.
 *
 * Cette route possède un `loading.tsx` : la coquille de chargement est envoyée
 * avec le statut 200 avant que la page ne puisse atteindre son `notFound()`,
 * d'où un « soft 404 » (corps « introuvable », statut 200) pénalisant en
 * référencement. Le layout s'exécute **avant** cette frontière de streaming :
 * un slug inconnu ou non publié répond donc un vrai 404.
 *
 * La requête est une simple vérification d'existence (clé unique indexée) ; la
 * page refait sa propre lecture pour décider de l'affichage.
 */
export default async function ArticleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const exists = await prisma.article.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: { id: true },
  });

  if (!exists) {
    notFound();
  }

  return children;
}
