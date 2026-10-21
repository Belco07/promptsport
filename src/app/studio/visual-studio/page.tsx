import Link from "next/link";
import VisualEditorLoader from "@/components/visual-studio/VisualEditorLoader";

export const metadata = { title: "Visual Studio", robots: { index: false, follow: false } };
export default async function VisualStudioPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const channel = typeof params.channel === "string" && /^[a-f0-9-]{36}$/.test(params.channel) ? params.channel : undefined;
  return <main className="p-4 text-foreground md:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-3xl font-black">Visual Studio</h1><p className="mt-1 text-sm text-muted-foreground">Composez vos visuels pour les articles et les réseaux sociaux.</p></div>
      <Link href="/studio/articles" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">Retour aux articles</Link>
    </div>
    <VisualEditorLoader channel={channel} />
  </main>;
}
