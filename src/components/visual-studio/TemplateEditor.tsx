"use client";
import { useEffect, useRef, useState } from "react";
import { StaticCanvas, FabricImage, FabricObject } from "fabric";
import { lockTemplate, type TemplateDocument } from "@/lib/visual-template";
import { saveVisualImage } from "@/app/studio/visual-studio/actions";
import { uploadImage } from "@/app/studio/articles/actions";
import { isVisualImageUrl } from "./VisualStudioButton";
import VisualEditor from "./VisualEditor";
const button = "rounded-md border border-border bg-card px-4 py-2 font-semibold text-foreground disabled:opacity-50";
const input = "block w-full rounded-md border border-border bg-background p-2 text-foreground";
type FieldObject = FabricObject & { field?: string; text?: string };
export default function TemplateEditor({ admin = false, document: initial, name, channel }: { admin?: boolean; document?: TemplateDocument; name?: string; channel?: string }) {
  const element = useRef<HTMLCanvasElement>(null); const container = useRef<HTMLDivElement>(null); const canvas = useRef<StaticCanvas | null>(null);
  const [title, setTitle] = useState(""); const [subject, setSubject] = useState(""); const [ready, setReady] = useState(false);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState("");
  const popup = useRef<Window | null>(null); const token = useRef("");
  useEffect(() => {
    if (admin || !initial || !element.current) return;
    const c = new StaticCanvas(element.current); canvas.current = c; let active = true;
    function fit() { if (!container.current) return; const width = Math.min(initial!.width, container.current.clientWidth); c.setDimensions({ width, height: width * initial!.height / initial!.width }); c.setZoom(width / initial!.width); c.requestRenderAll(); }
    const observer = new ResizeObserver(fit); observer.observe(container.current!);
    void (async () => { try {
      const font = await new FontFace("Montserrat", "url(/fonts/Montserrat.ttf)", { weight: "100 900" }).load(); document.fonts.add(font);
      await c.loadFromJSON(lockTemplate(initial)); if (!active) return;
      for (const object of c.getObjects() as FieldObject[]) { if (object.field === "title") setTitle(object.text ?? ""); if (object.field === "subject") setSubject(object.text ?? ""); }
      fit(); setReady(true);
    } catch { if (active) setMessage("Impossible de charger le template. Contactez un administrateur."); } })();
    return () => { active = false; observer.disconnect(); canvas.current = null; void c.dispose(); };
  }, [admin, initial]);
  function change(field: string, text: string) { const c = canvas.current; if (!c) return; for (const object of c.getObjects() as FieldObject[]) if (object.field === field) object.set({ text } as Partial<FabricObject>); c.requestRenderAll(); setSaved(""); }
  async function background(url: string) {
    const c = canvas.current; if (!c || !initial) return; const image = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });
    if (image.width * image.height > 40_000_000) throw Error("Image trop grande : 40 mégapixels maximum.");
    const scale = Math.max(initial.width / image.width, initial.height / image.height);
    image.set({ originX: "left", originY: "top", left: (initial.width - image.width * scale) / 2, top: (initial.height - image.height * scale) / 2, scaleX: scale, scaleY: scale });
    c.backgroundImage = image; c.requestRenderAll(); setSaved("");
  }
  useEffect(() => { function receive(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.channel !== token.current || event.data?.type !== "visual-studio:saved" || !isVisualImageUrl(event.data.url)) return;
    void run(async () => { await background(new URL(event.data.url, window.location.origin).href); setMessage("Fond chargé."); });
  } window.addEventListener("message", receive); return () => window.removeEventListener("message", receive); });
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Opération impossible."); } finally { setBusy(false); } }
  async function exportFinal() {
    const c = canvas.current; if (!c) return; const output = c.toCanvasElement(1 / c.getZoom());
    const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, "image/png")); if (!blob) throw Error("Export impossible.");
    const form = new FormData(); form.set("file", new File([blob], "visual.png", { type: "image/png" })); const result = await saveVisualImage(form); if (!result.ok) throw Error(result.error);
    setSaved(result.url); setMessage("Visuel final enregistré.");
    if (channel && window.opener && !window.opener.closed) window.opener.postMessage({ type: "visual-studio:saved", channel, url: result.url }, window.location.origin);
  }
  if (admin) return <VisualEditor templateAdmin initialDocument={initial} initialName={name} />;
  return <div className="space-y-4"><p role="status" aria-live="polite">{message}</p>
    <fieldset disabled={!ready || busy} className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2"><legend className="px-2 font-bold">{name}</legend>
      <label>Titre<input className={input} maxLength={200} value={title} onChange={event => { setTitle(event.target.value); change("title", event.target.value); }} /></label>
      <label>Sujet<input className={input} maxLength={100} value={subject} onChange={event => { setSubject(event.target.value); change("subject", event.target.value); }} /></label>
      <button type="button" className={button} onClick={() => { token.current = crypto.randomUUID(); popup.current = window.open(`/studio/composer?channel=${token.current}`, "_blank"); if (!popup.current) setMessage("Autorisez l’ouverture du Compositeur dans un nouvel onglet."); }}>Composer un fond</button>
      <label>Charger un fond<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void run(async () => { if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("PNG, JPEG ou WebP de 5 Mo maximum."); const form = new FormData(); form.set("file", file); const result = await uploadImage(form); if (!result.ok) throw Error(result.error); await background(new URL(result.url, window.location.origin).href); }); }} /></label>
      <button type="button" className={button} onClick={() => void run(exportFinal)}>Générer le visuel final</button>
    </fieldset>
    {!ready && <p role="status">Chargement du template…</p>}
    <div ref={container} className="min-w-0 overflow-hidden rounded-xl border border-border"><canvas ref={element} aria-label="Aperçu du template verrouillé" /></div>
    {saved && <div><label>URL de l’image enregistrée<input className={input} readOnly value={saved} /></label><a href={saved} target="_blank" rel="noopener noreferrer" className="underline">Ouvrir le visuel final</a><button type="button" className={`${button} ml-3`} onClick={() => void navigator.clipboard.writeText(saved).then(() => setMessage("URL copiée."), () => setMessage("Copiez le lien du visuel."))}>Copier l’URL</button></div>}
  </div>;
}
