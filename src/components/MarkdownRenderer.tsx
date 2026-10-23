import Image from "next/image";
import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";

import { BlockquoteEnriched } from "@/components/BlockquoteEnriched";
import { SocialEmbed } from "@/components/embeds/SocialEmbed";
import { remarkQuotes } from "@/lib/remark-quotes";
import { remarkSocialEmbeds } from "@/lib/remark-social-embeds";

/**
 * Rendu Markdown partagé (WP15d).
 *
 * C'est **le** rendu du site : la page article publique et l'aperçu de
 * l'éditeur l'utilisent tous les deux, ce qui garantit qu'un aperçu est
 * identique à la publication. La mise en forme générale vit dans `.article-body`
 * (src/app/globals.css) ; seuls les éléments à comportement propre sont
 * surchargés ici.
 *
 * Plugins, dans l'ordre :
 *   1. `remark-gfm` — tableaux, listes de tâches, liens automatiques ;
 *   2. `remark-directive` — analyse des directives `::social{…}` et `::quote{…}` ;
 *   3. `remark-quotes` — citations enrichies (WP15d) ;
 *   4. `remark-social-embeds` — embeds sociaux (WP15c).
 *
 * Le composant n'utilise ni état ni API navigateur : il reste rendu côté serveur
 * sur la page article et bascule côté client dans l'aperçu de l'éditeur.
 */

const markdownComponents = {
  blockquote: (props: React.ComponentProps<"blockquote">) => {
    // Citation enrichie (WP15d) : le plugin a marqué le nœud.
    const author = props["data-quote-author" as keyof typeof props];
    if (props["data-quote" as keyof typeof props] !== undefined) {
      return (
        <BlockquoteEnriched author={typeof author === "string" ? author : undefined}>
          {props.children}
        </BlockquoteEnriched>
      );
    }
    return (
      <blockquote
        {...props}
        style={{ color: "hsl(var(--muted-foreground))", borderColor: "var(--ed-link, hsl(var(--accent)))" }}
      />
    );
  },
  code: (props: React.ComponentProps<"code">) => (
    <code {...props} style={{ backgroundColor: "hsl(var(--muted))", color: "hsl(var(--foreground))" }} />
  ),
  a: (props: React.ComponentProps<"a">) => (
    <a target="_blank" rel="noopener noreferrer" {...props} />
  ),
  table: (props: React.ComponentProps<"table">) => (
    // Les tableaux Markdown peuvent être larges : ils défilent sur mobile.
    <div className="scroll-x my-5">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th className="border border-border bg-muted px-3 py-2 text-left font-semibold" {...props} />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td className="border border-border px-3 py-2" {...props} />
  ),
  p: ({ children, ...props }: React.ComponentProps<"p">) => {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement<{ src?: string; title?: string }>(child) && child.props.src && (!Array.isArray(children) || children.length === 1)) return <figure className="my-8">{children}{child.props.title && <figcaption className="mt-2 text-sm text-muted-foreground">{child.props.title}</figcaption>}</figure>;
    return <p {...props}>{children}</p>;
  },
  img: ({ src, alt, title }: React.ComponentProps<"img">) => typeof src === "string" && src ? (
    <Image src={src} alt={alt ?? ""} title={title} width={1200} height={800} sizes="(max-width: 768px) 100vw, 820px" unoptimized={!(src.startsWith("/") || /^https:\/\/[^/]+\.public\.blob\.vercel-storage\.com\//.test(src))} className="my-5 h-auto w-full" />
  ) : null,
  hr: () => <hr className="my-8 border-border" style={{ borderColor: "hsl(var(--border))" }} />,
  pre: (props: React.ComponentProps<"pre">) => (
    <pre className="scroll-x my-5 rounded-xl bg-muted p-4 text-sm text-foreground" {...props} />
  ),
  // Embeds sociaux (WP15c) : le plugin remark transforme les directives
  // `::social{…}` en div porteurs de `data-social-embed` / `data-social-url`.
  div: (props: React.ComponentProps<"div">) => {
    const platform = props["data-social-embed" as keyof typeof props];
    const url = props["data-social-url" as keyof typeof props];
    if (typeof platform === "string" && typeof url === "string") {
      return <SocialEmbed platform={platform} url={url} />;
    }
    return <div {...props} />;
  },
};

export function MarkdownRenderer({
  markdown,
  className,
}: {
  /** Markdown brut de l'article (ou de l'aperçu). */
  markdown: string;
  /** Classes du conteneur : `article-body` apporte la typographie éditoriale. */
  className?: string;
}): ReactNode {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkQuotes, remarkSocialEmbeds]}
        components={markdownComponents}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
