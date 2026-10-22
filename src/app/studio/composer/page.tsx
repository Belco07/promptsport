import ComposerWorkspace from "@/components/visual-studio/ComposerWorkspace";
import { prisma } from "@/lib/prisma";
import { defaultVisualTemplate, DEFAULT_TEMPLATE_NAME, type TemplateDocument } from "@/lib/visual-template";

export const metadata = { title: "Compositeur", robots: { index: false, follow: false } };
export default async function ComposerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const channel = typeof params.channel === "string" && /^[a-f0-9-]{36}$/.test(params.channel) ? params.channel : undefined;
  const templates = (await prisma.visualTemplate.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, document: true } })).sort((a,b) => a.id === "active" ? -1 : b.id === "active" ? 1 : 0);
  const template = templates[0];
  return <main className="min-w-0 max-w-full flex-1 p-3 text-foreground md:p-5">
    <h1 className="text-3xl font-black">Compositeur de fonds</h1>
    <p className="my-2 text-sm text-muted-foreground">Importez ou composez votre fond, puis appliquez le template.</p>
    <ComposerWorkspace templates={templates.map(item => ({ ...item, document: item.document as TemplateDocument }))} channel={channel} document={(template?.document as TemplateDocument | undefined) ?? defaultVisualTemplate()} name={template?.name ?? DEFAULT_TEMPLATE_NAME} />
  </main>;
}
