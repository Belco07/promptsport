import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import TemplateLoader from "@/components/visual-studio/TemplateLoader";
import type { TemplateDocument } from "@/lib/visual-template";

export const dynamic = "force-dynamic";
export default async function TemplatesPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") redirect("/studio");
  const template = await prisma.visualTemplate.findUnique({ where: { id: "active" } });
  return <main className="min-w-0 flex-1 p-4"><h1 className="mb-4 text-3xl font-bold">Template administrateur</h1><TemplateLoader admin name={template?.name} document={template?.document as TemplateDocument | undefined} /></main>;
}
