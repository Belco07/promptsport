import type { Paragraph, Root } from "mdast";
import { visit } from "unist-util-visit";

import { normaliseSocialUrl, socialDirective } from "@/lib/social-embeds";

/**
 * Plugin remark (WP15c) : transforme les directives
 * `::social{platform="instagram" url="…"}` en un nœud dont le rendu HTML est un
 * `<div>` porteur des attributs `data-social-embed` et `data-social-url`.
 *
 * Le composant `SocialEmbed` (Client Component) est branché sur ce `<div>` par
 * la table `components` de react-markdown : le plugin reste ainsi sans
 * dépendance React et fonctionne aussi hors de react-markdown.
 *
 * `remark-directive` doit être exécuté avant ce plugin pour que les directives
 * existent dans l'arbre mdast.
 */

type DirectiveLike = {
  type: string;
  name?: string;
  attributes?: Record<string, unknown> | null;
};

/** Types de directives acceptés : bloc, bloc conteneur et en ligne. */
const DIRECTIVE_TYPES = new Set(["leafDirective", "containerDirective", "textDirective"]);

export function remarkSocialEmbeds() {
  return (tree: Root) => {
    visit(tree, (node, index, parent) => {
      // La racine et les nœuds sans position exploitable sont ignorés.
      if (!parent || typeof index !== "number") return;

      const directive = node as unknown as DirectiveLike;
      if (!DIRECTIVE_TYPES.has(directive.type) || directive.name !== "social") return;

      const attributes = directive.attributes ?? {};
      const rawPlatform =
        typeof attributes.platform === "string" ? attributes.platform.trim().toLowerCase() : "";
      const rawUrl = typeof attributes.url === "string" ? attributes.url : "";
      const url = normaliseSocialUrl(rawPlatform, rawUrl);

      // Directive incomplète ou adresse invalide : le texte d'origine reste
      // visible dans l'article. Le nœud `leafDirective` serait sinon supprimé
      // silencieusement par la conversion en HTML, et l'auteur ne verrait
      // jamais que son embed n'a pas été pris en compte.
      if (!url) {
        parent.children.splice(index, 1, {
          type: "paragraph",
          children: [{ type: "text", value: socialDirective(rawPlatform, rawUrl) }],
        });
        return index + 1;
      }

      const replacement: Paragraph = {
        type: "paragraph",
        children: [],
        data: {
          // `hName`/`hProperties` sont appliqués par mdast-util-to-hast : le
          // paragraphe devient le div attendu par le rendu public.
          hName: "div",
          hProperties: {
            "data-social-embed": rawPlatform,
            "data-social-url": url,
          },
        },
      };

      parent.children.splice(index, 1, replacement);
      // Le nœud remplacé ne doit pas être visité à nouveau.
      return index + 1;
    });
  };
}

export default remarkSocialEmbeds;
