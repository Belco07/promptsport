import type { Blockquote, Paragraph, Root } from "mdast";
import { visit } from "unist-util-visit";

/**
 * Plugin remark (WP15d) : transforme les directives `::quote{…}` en citations
 * enrichies, rendues par `BlockquoteEnriched`.
 *
 * Deux syntaxes sont acceptées :
 *
 *   ::quote[texte de la citation]{auteur="Victor Hugo"}   — recommandée
 *   ::quote{#texte auteur="Victor Hugo"}                  — forme du brief
 *
 * La seconde vient de la grammaire `remark-directive` : `#texte` est un
 * identifiant, donc **un seul mot** (une phrase y perdrait tout ce qui suit le
 * premier espace). L'éditeur utilise cette forme quand le texte tient en un mot
 * et la forme entre crochets sinon ; les deux sont lues ici.
 *
 * Le nœud produit est un `blockquote` porteur de `data-quote-author` : le rendu
 * public et l'aperçu le reconnaissent et affichent la citation enrichie, tandis
 * qu'une citation Markdown classique (`> …`) garde son style d'origine.
 */

type DirectiveLike = {
  type: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
  children?: Array<{ type: string; value?: string }>;
};

/** Texte de la citation : contenu entre crochets, sinon l'identifiant `#…`. */
function quoteText(directive: DirectiveLike): string {
  const label = (directive.children ?? [])
    .map((child) => (typeof child.value === "string" ? child.value : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (label) return label;

  const identifier = directive.attributes?.id;
  return typeof identifier === "string" ? identifier.replace(/\s+/g, " ").trim() : "";
}

/** Auteur : `auteur` (brief) ou `author` (anglais), les deux acceptés. */
function quoteAuthor(directive: DirectiveLike): string {
  const raw = directive.attributes?.auteur ?? directive.attributes?.author;
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
}

export function remarkQuotes() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (!parent || typeof index !== "number") return;

      const directive = node as unknown as DirectiveLike;
      if (directive.type !== "leafDirective" || directive.name !== "quote") return;

      const text = quoteText(directive);
      const author = quoteAuthor(directive);

      // Citation vide : le texte d'origine reste visible plutôt que de
      // disparaître silencieusement à la conversion HTML.
      if (!text) {
        const paragraph: Paragraph = {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: `::quote{${author ? `auteur="${author}"` : ""}}`,
            },
          ],
        };
        parent.children.splice(index, 1, paragraph);
        return index + 1;
      }

      const quote: Blockquote = {
        type: "blockquote",
        children: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
        data: {
          hProperties: {
            // Marqueur lu par la table `components` de MarkdownRenderer.
            "data-quote": "true",
            ...(author ? { "data-quote-author": author } : {}),
          },
        },
      };

      parent.children.splice(index, 1, quote);
      return index + 1;
    });
  };
}

export default remarkQuotes;
