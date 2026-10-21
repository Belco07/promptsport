"use client";

import { useTheme } from "next-themes";
import { useEffect, useState, useRef } from "react";

import {
  MDXEditor, BoldItalicUnderlineToggles, StrikeThroughSupSubToggles,
  BlockTypeSelect, ListsToggle, CreateLink, CodeToggle, InsertCodeBlock,
  InsertThematicBreak, UndoRedo, headingsPlugin, listsPlugin, quotePlugin,
  linkPlugin, linkDialogPlugin, thematicBreakPlugin, markdownShortcutPlugin,
  toolbarPlugin, codeBlockPlugin, codeMirrorPlugin, tablePlugin, imagePlugin,
  directivesPlugin, type MDXEditorMethods,
} from "@mdxeditor/editor";

import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { SocialEmbedButton } from "@/components/embeds/SocialEmbedButton";
import { socialEmbedDescriptor } from "@/components/embeds/social-embed-directive";
import { VisualStudioButton } from "@/components/visual-studio/VisualStudioButton";
import { imageMarkdown } from "@/components/editor/imageUploadPlugin";
import { ImageUploadButton } from "@/components/editor/imageUploadPlugin";
import { EmojiButton } from "@/components/editor/EmojiButton";
import { QuoteButton, quoteDescriptor } from "@/components/editor/quoteDirective";

function VisualStudioInsertButton({ onImage }: { onImage: (url: string) => void }) {
  return <VisualStudioButton onImage={onImage} />;
}

/** Délai d'attente avant de relancer le rendu de l'aperçu (WP15d). */
const PREVIEW_DEBOUNCE_MS = 500;

/** Classes du corps d'article public, réutilisées par l'aperçu. */
const PREVIEW_BODY_CLASS =
  "article-body !max-w-none !text-lg !leading-[1.7] md:!text-xl [&_p]:!leading-[1.7]";

export default function RichTextEditor({ value, onChange }: {
  value: string;
  onChange: (markdown: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<MDXEditorMethods>(null);
  function appendVisual(url: string) {
    // Le retour d’un autre onglet n’a pas forcément de sélection Lexical active.
    const current = editorRef.current?.getMarkdown() ?? value;
    const next = current.trimEnd() + "\n\n" + imageMarkdown(url, "Visuel PromptSport");
    editorRef.current?.setMarkdown(next);
    onChange(next);
  }
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  // Markdown effectivement rendu : mis à jour après le délai d'attente.
  const [previewMarkdown, setPreviewMarkdown] = useState(value);
  const [isRendering, setIsRendering] = useState(false);

  // Aperçu live : débounce de 500 ms pour ne pas re-rendre à chaque frappe.
  useEffect(() => {
    if (tab !== "preview" || value === previewMarkdown) return;
    setIsRendering(true);
    const timer = setTimeout(() => {
      setPreviewMarkdown(value);
      setIsRendering(false);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, tab, previewMarkdown]);

  function openPreview() {
    // Bascule immédiate sur le contenu courant : pas d'attente à l'ouverture.
    setPreviewMarkdown(value);
    setIsRendering(false);
    setTab("preview");
  }

  return <div className="rich-text-editor">
    <div className="editor-tabs" role="tablist" aria-label="Mode d’édition">
      <button
        type="button"
        role="tab"
        id="editor-tab-edit"
        aria-controls="editor-panel-edit"
        aria-selected={tab === "edit"}
        className={`editor-tab${tab === "edit" ? " editor-tab--active" : ""}`}
        onClick={() => setTab("edit")}
      >
        Éditer
      </button>
      <button
        type="button"
        role="tab"
        id="editor-tab-preview"
        aria-controls="editor-panel-preview"
        aria-selected={tab === "preview"}
        className={`editor-tab${tab === "preview" ? " editor-tab--active" : ""}`}
        onClick={openPreview}
      >
        Aperçu
      </button>
    </div>

    <div
      id="editor-panel-edit"
      role="tabpanel"
      aria-labelledby="editor-tab-edit"
      className={tab === "edit" ? undefined : "hidden"}
    >
      <MDXEditor ref={editorRef} markdown={value} onChange={onChange} className={resolvedTheme === "dark" ? "dark-theme" : undefined}
        contentEditableClassName="rich-text-editor-content"
        placeholder="Rédigez votre article…"
        plugins={[
          // Existing H4–H6 remain supported by the import/export visitors.
          headingsPlugin({ allowedHeadingLevels: [1, 2, 3] }), listsPlugin(), quotePlugin(),
          tablePlugin(), imagePlugin({ disableImageResize: true }),
          linkPlugin(), linkDialogPlugin(), thematicBreakPlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
          codeMirrorPlugin({ codeBlockLanguages: { txt: "Texte", js: "JavaScript", css: "CSS", html: "HTML", ts: "TypeScript" } }),
          // Directives (WP15c embeds sociaux, WP15d citations).
          directivesPlugin({ directiveDescriptors: [socialEmbedDescriptor, quoteDescriptor] }),
          markdownShortcutPlugin(),
          toolbarPlugin({ toolbarContents: () => <>
            <UndoRedo /><BoldItalicUnderlineToggles options={["Bold", "Italic"]} /><StrikeThroughSupSubToggles options={["Strikethrough"]} />
            <BlockTypeSelect /><ListsToggle /><CreateLink /><CodeToggle />
            <InsertCodeBlock /><InsertThematicBreak /><ImageUploadButton /><VisualStudioInsertButton onImage={appendVisual} /><QuoteButton /><SocialEmbedButton /><EmojiButton />
          </> }),
        ]} />
    </div>

    <div
      id="editor-panel-preview"
      role="tabpanel"
      aria-labelledby="editor-tab-preview"
      className={tab === "preview" ? "editor-preview" : "hidden"}
    >
      {tab === "preview" ? <>
        <p className="editor-preview-status" role="status" aria-live="polite">
          {isRendering ? "Rendu en cours…" : "Aperçu du rendu final"}
        </p>
        {/* Exactement le rendu de la page article publique (MarkdownRenderer). */}
        <MarkdownRenderer markdown={previewMarkdown} className={PREVIEW_BODY_CLASS} />
      </> : null}
    </div>
  </div>;
}
