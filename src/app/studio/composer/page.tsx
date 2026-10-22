import Link from "next/link";
import VisualEditorLoader from "@/components/visual-studio/VisualEditorLoader";

export const metadata = { title: "Compositeur", robots: { index: false, follow: false } };
export default async function ComposerPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const channel = typeof params.channel === "string" && /^[a-f0-9-]{36}$/.test(params.channel) ? params.channel : undefined;
  return <main className="min-w-0 flex-1 p-4 text-foreground md:p-8">
    <h1 className="text-3xl font-black">Compositeur de fonds</h1>
    <p className="my-4 text-muted-foreground">Assemblez vos images, puis enregistrez le fond pour votre template.</p>
    <Link href="/studio/visual-studio" className="mb-6 inline-block underline">Appliquer un template</Link>
    <VisualEditorLoader channel={channel} composer />
  </main>;
}
