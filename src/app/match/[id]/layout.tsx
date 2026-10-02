import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

/**
 * Garde d'existence d'un match (même raison que pour /article/[slug] : le
 * `loading.tsx` de la route ferait répondre 200 avant le `notFound()` de la
 * page). Le layout s'exécute avant la frontière de streaming.
 */
export default async function MatchLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const exists = await prisma.match.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!exists) {
    notFound();
  }

  return children;
}
