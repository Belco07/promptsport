import type { ReactNode } from "react";

import { SectionHeading } from "@/components/SectionHeading";

/** Section de page avec le titre commun du site (pastille, casse normale). */
export function SectionBlock({ id, title, href, linkLabel = "Voir tout", children, description }: {
  id: string; title: string; href?: string; /** Libellé du lien d'en-tête (WP16d). */ linkLabel?: string; children: ReactNode; description?: string;
}) {
  return <section id={id} aria-labelledby={`${id}-title`} className="min-w-0">
    <SectionHeading id={`${id}-title`} title={title} href={href} linkLabel={linkLabel} description={description} />
    {children}
  </section>;
}
