"use client";
import dynamic from "next/dynamic";
import type { TemplateDocument } from "@/lib/visual-template";
import Link from "next/link";
import { useRouter } from "next/navigation";
const Editor = dynamic(() => import("./TemplateEditor"), { ssr: false, loading: () => <p role="status">Chargement de l’éditeur…</p> });
export default function TemplateLoader({ templates = [], ...props }: { admin?: boolean; saved?: boolean; document?: TemplateDocument; name?: string; channel?: string; templateId?: string; templates?: { id: string; name: string }[] }) {
  const router = useRouter();
  return <><div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-end">
    <label className="min-w-0 flex-1 text-sm font-bold">Bibliothèque de templates<select aria-label="Template à modifier" className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-border bg-background p-2 font-normal" value={props.templateId ?? ""} onChange={event => router.push(`/studio/templates?template=${encodeURIComponent(event.target.value)}`, { scroll: false })}><option value="" disabled>Nouveau template</option>{props.templateId === "active" && !templates.some(item => item.id === "active") && <option value="active">Modèle éditorial par défaut</option>}{templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <Link href="/studio/templates?new=1" className="rounded-md border border-border px-4 py-3 text-center text-sm font-bold">Nouveau template</Link>
  </div><Editor key={props.templateId ?? "new"} {...props} /></>;
}
