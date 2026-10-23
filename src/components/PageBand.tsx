"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Breadcrumbs, type BreadcrumbItem } from "@/components/Breadcrumbs";
import { publicBreadcrumbItems } from "@/components/PublicBreadcrumbs";

/**
 * Bandeau d'en-tête de page, comme l'« archive header » de la référence
 * Digital Haven : pleine largeur, trame de points (`.page-band` dans
 * skin.css), fil d'Ariane puis titre de la page.
 *
 * Utilisé sur toutes les pages publiques sauf l'accueil et les articles. Le
 * fil d'Ariane des pages statiques est déduit de l'URL (même table que
 * `PublicBreadcrumbs`, dont la copie globale est alors masquée par CSS et ne
 * garde que les données structurées) ; les pages d'entité passent le leur.
 *
 * Sans `title`, le bandeau n'enveloppe que `children` : les pages club,
 * compétition, joueur ou match y placent leur propre en-tête.
 */
export function PageBand({
  title,
  kicker,
  description,
  crumbs,
  children,
  className = "",
}: {
  title?: ReactNode;
  /** Petite ligne en capitales au-dessus du titre. */
  kicker?: ReactNode;
  description?: ReactNode;
  /** Fil d'Ariane explicite ; sinon déduit de l'URL pour les pages statiques. */
  crumbs?: BreadcrumbItem[];
  children?: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const items = crumbs ?? publicBreadcrumbItems(pathname);

  return (
    <div className={`page-band ${className}`}>
      {items ? <Breadcrumbs items={items} structuredData={false} className="mb-1" /> : null}
      {kicker ? (
        <p className="mb-1 text-xs font-bold uppercase tracking-[1px] text-muted-foreground">{kicker}</p>
      ) : null}
      {title ? (
        <h1 className="text-[26px] font-extrabold leading-[1.3] tracking-[-0.87px] text-foreground md:text-[30px]">
          {title}
        </h1>
      ) : null}
      {description ? <p className="mt-2 max-w-3xl text-base leading-7 text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  );
}
