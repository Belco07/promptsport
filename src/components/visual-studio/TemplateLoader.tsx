"use client";
import dynamic from "next/dynamic";
import type { TemplateDocument } from "@/lib/visual-template";
const Editor = dynamic(() => import("./TemplateEditor"), { ssr: false, loading: () => <p role="status">Chargement de l’éditeur…</p> });
export default function TemplateLoader(props: { admin?: boolean; document?: TemplateDocument; name?: string; channel?: string }) {
  return <Editor {...props} />;
}
