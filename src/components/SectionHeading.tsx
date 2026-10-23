import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Titre de section unique du site, disposé comme la référence « Digital
 * Haven » : pastille de couleur, titre gras en casse normale, sans filet
 * épais ; lien « Voir tout » facultatif à droite et description dessous.
 */
export function SectionHeading({
  id,
  title,
  href,
  linkLabel = "Voir tout",
  description,
  as: Tag = "h2",
  className = "",
}: {
  id?: string;
  title: ReactNode;
  href?: string;
  linkLabel?: string;
  description?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={`mb-5 ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <Tag id={id} className="flex items-center gap-2.5 text-[22px] font-black leading-tight tracking-tight text-foreground">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
          {title}
        </Tag>
        {href && (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-editorial-link hover:underline">
            {linkLabel} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
