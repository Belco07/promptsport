"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { TemplateDocument } from "@/lib/visual-template";

const Composer = dynamic(() => import("./VisualEditor"), { ssr: false });
const Template = dynamic(() => import("./TemplateEditor"), { ssr: false });

export default function ComposerWorkspace({ document, name, channel }: { document?: TemplateDocument; name?: string; channel?: string }) {
  const [background, setBackground] = useState("");
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2">
    <section className="min-w-0 overflow-y-auto rounded-xl border border-border bg-card p-3 lg:h-[calc(100dvh-125px)]" aria-labelledby="compose-heading">
      <h2 id="compose-heading" className="text-lg font-bold">1. Importer ou composer</h2>
      <p className="mb-3 text-sm text-muted-foreground">Importez depuis votre ordinateur. Le montage est facultatif.</p>
      <Composer composer compact onSaved={setBackground} />
      {background && <div className="mt-2 rounded border border-border p-2 text-sm"><a href={background} draggable onDragStart={event => event.dataTransfer.setData("text/uri-list", new URL(background, location.origin).href)} className="text-editorial-link underline">Fond enregistré — glissez ce lien dans l’aperçu de droite</a></div>}
    </section>
    <section className="min-w-0 overflow-y-auto rounded-xl border border-border bg-card p-3 lg:h-[calc(100dvh-125px)]" aria-labelledby="apply-heading">
      <h2 id="apply-heading" className="text-lg font-bold">2. Appliquer le template</h2>
      <p className="mb-3 text-sm text-muted-foreground">Fond, titre et sujet uniquement. La mise en page reste verrouillée.</p>
      {document ? <Template document={document} name={name} channel={channel} backgroundUrl={background} compact /> : <p>Un administrateur doit d’abord enregistrer un template actif.</p>}
    </section>
  </div>;
}
