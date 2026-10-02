import type { ElementType, ReactNode } from "react";

/**
 * Design system — carte (WP9).
 *
 * Conteneur de base : bord discret, coins arrondis, ombre douce, et élévation
 * au survol quand la carte est cliquable (`interactive`).
 *
 * `as` permet de conserver la sémantique HTML attendue par l'appelant
 * (`article` pour un article, `li` dans une liste, `section` pour un bloc).
 */

export function cardStyles({
  interactive = false,
  className = "",
}: { interactive?: boolean; className?: string } = {}): string {
  return [
    "rounded-xl border border-neutral-200 bg-white shadow-card",
    interactive
      ? "transition-shadow duration-200 hover:border-neutral-300 hover:shadow-card-hover"
      : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Card({
  as: Tag = "div",
  interactive = false,
  className = "",
  children,
  ...rest
}: {
  as?: ElementType;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Tag className={cardStyles({ interactive, className })} {...rest}>
      {children}
    </Tag>
  );
}

/** Zone de contenu d'une carte, avec le rembourrage standard. */
export function CardBody({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}
