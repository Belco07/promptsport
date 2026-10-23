"use client";

import { EntityLogo } from "@/components/EntityLogo";

/**
 * Logo de compétition des listes de matchs (pages club et scores) : même
 * composant que les pastilles du site, avec repli sur un trophée.
 */
export function CompetitionLogo({ slug, logoUrl, name }: { slug: string; logoUrl?: string | null; name?: string }) {
  return <EntityLogo kind="competition" name={name ?? slug} logoUrl={logoUrl} slug={slug} size={48} />;
}
