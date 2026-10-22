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
  const template = await prisma.visualTemplate.findUnique({ where: { id: "active" } });
  return <main className="min-w-0 flex-1 p-4 text-foreground md:p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-black">Visual Studio</h1><p className="mt-1 text-sm text-muted-foreground">Composez vos visuels pour les articles et les réseaux sociaux.</p></div>
      <Link href="/studio/articles" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Retour aux articles</Link>
    </div>
    <ComposerWorkspace document={(template?.document as TemplateDocument | undefined) ?? defaultVisualTemplate()} name={template?.name ?? DEFAULT_TEMPLATE_NAME} channel={channel} />
  </main>;
}
