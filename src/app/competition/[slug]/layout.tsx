import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

/**
 * Garde d'existence d'une compétition (même raison que pour /article/[slug] :
 * le `loading.tsx` de la route ferait répondre 200 avant le `notFound()` de la
 * page). Le layout s'exécute avant la frontière de streaming.
 */
export default async function CompetitionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const exists = await prisma.competition.findUnique({
    where: { slug },
    select: { id: true },
  });

  if (!exists) {
    notFound();
  }

  return children;
}
