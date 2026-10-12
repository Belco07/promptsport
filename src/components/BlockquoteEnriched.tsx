import type { ReactNode } from "react";

/**
 * Citation enrichie (WP15d) : texte en italique, auteur attribué en dessous,
 * bordure d'accent à gauche — présentation « magazine ».
 *
 * Composant purement présentatif, sans état ni accès au navigateur : il est
 * rendu aussi bien par la page article publique (Server Component) que par
 * l'aperçu de l'éditeur (Client Component).
 *
 * Les couleurs passent par les jetons sémantiques du thème (WP13) :
 * `--ed-link` (accent éditorial) pour la bordure quand la peau publique est
 * active, repli sur `--accent` dans l'espace de rédaction, `--foreground` et
 * `--muted-foreground` pour les textes.
 */
export function BlockquoteEnriched({
  author,
  children,
}: {
  author?: string;
  children: ReactNode;
}) {
  return (
    <figure className="quote-enriched">
      <blockquote className="quote-enriched-text">{children}</blockquote>
      {author ? <figcaption className="quote-enriched-author">{author}</figcaption> : null}
    </figure>
  );
}

export default BlockquoteEnriched;
