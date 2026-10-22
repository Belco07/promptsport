import Link from "next/link";
import TemplateLoader from "@/components/visual-studio/TemplateLoader";
import { prisma } from "@/lib/prisma";
import type { TemplateDocument } from "@/lib/visual-template";

export const metadata = { title: "Visual Studio", robots: { index: false, follow: false } };
export default async function VisualStudioPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const channel = typeof params.channel === "string" && /^[a-f0-9-]{36}$/.test(params.channel) ? params.channel : undefined;
  const template = await prisma.visualTemplate.findUnique({ where: { id: "active" } });
  return <main className="min-w-0 flex-1 p-4 text-foreground md:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-black">Visual Studio</h1><p className="mt-1 text-sm text-muted-foreground">Composez vos visuels pour les articles et les réseaux sociaux.</p></div>
      <Link href="/studio/articles" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Retour aux articles</Link>
    </div>
    {template ? <TemplateLoader document={template.document as TemplateDocument} name={template.name} channel={channel} /> : <div className="rounded-xl border border-border bg-card p-6"><p>Un administrateur doit enregistrer le template actif avant de générer un visuel.</p><Link href="/studio/composer" className="mt-4 inline-block underline">Préparer un fond dans le Compositeur</Link></div>}
  </main>;
}
