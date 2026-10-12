"use client";

import {
  useLexicalNodeRemove,
  useMdastNodeUpdater,
  type DirectiveDescriptor,
  type DirectiveEditorProps,
} from "@mdxeditor/editor";
import type { Directives } from "mdast-util-directive";
import { useState } from "react";

import { normaliseSocialUrl, socialPlatformLabel } from "@/lib/social-embeds";

/**
 * Directive `::social{platform="…" url="…"}` dans MDXEditor (WP15c).
 *
 * Le descripteur rend la directive visible et modifiable dans l'éditeur : sans
 * lui, MDXEditor affiche le texte brut de la directive.
 */

/** Éditeur de la directive : plateforme, adresse modifiable, suppression. */
function SocialEmbedDirectiveEditor({ mdastNode }: DirectiveEditorProps<Directives>) {
  const updateMdastNode = useMdastNodeUpdater<Directives>();
  const removeNode = useLexicalNodeRemove();

  const platform =
    typeof mdastNode.attributes?.platform === "string" ? mdastNode.attributes.platform : "";
  const url = typeof mdastNode.attributes?.url === "string" ? mdastNode.attributes.url : "";

  const [draft, setDraft] = useState(url);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const normalised = normaliseSocialUrl(platform, draft);
    if (!normalised) {
      setError(`Adresse invalide pour ${socialPlatformLabel(platform)}.`);
      return;
    }
    setError(null);
    setDraft(normalised);
    updateMdastNode({
      attributes: { ...(mdastNode.attributes ?? {}), platform, url: normalised },
    });
  };

  return (
    <div className="social-embed-directive" contentEditable={false}>
      <div className="social-embed-directive-head">
        <span className="social-embed-directive-platform">
          {socialPlatformLabel(platform) || "Réseaux sociaux"}
        </span>
        <button
          type="button"
          className="social-embed-directive-remove"
          onClick={() => removeNode()}
          title="Supprimer l’embed"
        >
          Supprimer
        </button>      </div>
      <div className="social-embed-directive-body">
        <input
          type="url"
          value={draft}
          aria-label="Adresse de la publication"
          placeholder="https://…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
          }}
        />
        <button type="button" className="social-embed-directive-save" onClick={save}>
          Mettre à jour
        </button>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="social-embed-directive-url">
          {url}
        </a>
      ) : null}
      {error ? (
        <p role="alert" className="social-embed-directive-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Descripteur enregistré auprès de `directivesPlugin`. */
export const socialEmbedDescriptor: DirectiveDescriptor<Directives> = {
  name: "Réseaux sociaux",
  attributes: ["platform", "url"],
  hasChildren: false,
  type: "leafDirective",
  testNode: (node) => node.type === "leafDirective" && node.name === "social",
  Editor: SocialEmbedDirectiveEditor,
};
