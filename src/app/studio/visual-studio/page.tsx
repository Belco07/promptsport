import Link from "next/link";
import ComposerWorkspace from "@/components/visual-studio/ComposerWorkspace";
import { prisma } from "@/lib/prisma";
import { defaultVisualTemplate, DEFAULT_TEMPLATE_NAME, type TemplateDocument } from "@/lib/visual-template";

export const metadata = { title: "Visual Studio", robots: { index: false, follow: false } };
export default async function VisualStudioPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const channel = typeof params.channel === "string" && /^[a-f0-9-]{36}$/.test(params.channel) ? params.channel : undefined;
  const templates = (await prisma.visualTemplate.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, document: true } })).sort((a,b) => a.id === "active" ? -1 : b.id === "active" ? 1 : 0);
  const template = templates[0];
  return <main className="min-w-0 flex-1 p-4 text-foreground md:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-black">Visual Studio</h1><p className="mt-1 text-sm text-muted-foreground">Composez vos visuels pour les articles et les réseaux sociaux.</p></div>
      <Link href="/studio/articles" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Retour aux articles</Link>
    </div>
    <ComposerWorkspace templates={templates.map(item => ({ ...item, document: item.document as TemplateDocument }))} document={(template?.document as TemplateDocument | undefined) ?? defaultVisualTemplate()} name={template?.name ?? DEFAULT_TEMPLATE_NAME} channel={channel} />
  </main>;
}
