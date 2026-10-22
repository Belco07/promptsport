"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { TemplateDocument } from "@/lib/visual-template";

const Composer = dynamic(() => import("./VisualEditor"), { ssr: false });
const Template = dynamic(() => import("./TemplateEditor"), { ssr: false });

export default function ComposerWorkspace({ document, name, channel }: { document?: TemplateDocument; name?: string; channel?: string }) {
  const [background, setBackground] = useState("");
  const [step, setStep] = useState("compose");
  return <div className="grid min-w-0 gap-4 lg:grid-cols-2">
    <nav aria-label="Étapes du visuel" className="grid grid-cols-2 gap-2 lg:hidden">
      {[['compose','1. Composer'],['apply','2. Appliquer']].map(([id,label]) => <button key={id} type="button" aria-pressed={step === id} onClick={() => setStep(id)} className={`min-h-11 rounded-lg border border-border px-3 py-2 text-sm font-bold ${step === id ? 'bg-primary text-white' : 'bg-card text-foreground'}`}>{label}</button>)}
    </nav>
    <section className={`${step !== 'compose' ? 'hidden lg:block' : ''} min-w-0 rounded-xl border border-border bg-card p-3 lg:h-[calc(100dvh-125px)] lg:overflow-y-auto`} aria-labelledby="compose-heading">
      <h2 id="compose-heading" className="text-lg font-bold">1. Importer ou composer</h2>
      <p className="mb-3 text-sm text-muted-foreground">Importez depuis votre ordinateur. Le montage est facultatif.</p>
      <Composer composer compact onSaved={url => { setBackground(url); setStep('apply'); }} />
      {background && <div className="mt-2 rounded border border-border p-2 text-sm"><a href={background} draggable onDragStart={event => event.dataTransfer.setData("text/uri-list", new URL(background, location.origin).href)} className="break-words text-editorial-link underline">Fond enregistré — chargé automatiquement dans le template</a></div>}
    </section>
    <section className={`${step !== 'apply' ? 'hidden lg:block' : ''} min-w-0 rounded-xl border border-border bg-card p-3 lg:h-[calc(100dvh-125px)] lg:overflow-y-auto`} aria-labelledby="apply-heading">
      <h2 id="apply-heading" className="text-lg font-bold">2. Appliquer le template</h2>
      <p className="mb-3 text-sm text-muted-foreground">Fond, titre et sujet uniquement. La mise en page reste verrouillée.</p>
      {document ? <Template document={document} name={name} channel={channel} backgroundUrl={background} compact /> : <p>Un administrateur doit d’abord enregistrer un template actif.</p>}
    </section>
  </div>;
}
