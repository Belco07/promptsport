"use client";
import dynamic from "next/dynamic";
const VisualEditor = dynamic(() => import("./VisualEditor"), {
  ssr: false,
  loading: () => <p role="status" className="p-8 text-muted-foreground">Chargement du Visual Studio…</p>,
});
export default function VisualEditorLoader({ channel, composer = false }: { channel?: string; composer?: boolean }) {
  return <VisualEditor channel={channel} composer={composer} />;
}
