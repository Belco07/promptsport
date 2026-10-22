import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TemplateLoader from "@/components/visual-studio/TemplateLoader";
import { defaultVisualTemplate, DEFAULT_TEMPLATE_NAME, type TemplateDocument } from "@/lib/visual-template";

export const dynamic = "force-dynamic";
export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/studio");
  const params = await searchParams;
  const templates = await prisma.visualTemplate.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, document: true } });
  const isNew = params.new === "1";
  const template = isNew ? undefined : templates.find(item => item.id === params.template) ?? templates.find(item => item.id === "active") ?? templates[0];
  return <main className="min-w-0 flex-1 p-4"><h1 className="mb-4 text-3xl font-bold">Template administrateur</h1><TemplateLoader admin saved={params.saved === "1"} templateId={isNew ? undefined : template?.id ?? "active"} templates={templates.map(({ id, name }) => ({ id, name }))} name={isNew ? "Nouveau template" : template?.name ?? DEFAULT_TEMPLATE_NAME} document={(template?.document as TemplateDocument | undefined) ?? defaultVisualTemplate()} /></main>;
}
