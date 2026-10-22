"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, FabricImage, FabricObject } from "fabric";
import { lockTemplate, type TemplateDocument } from "@/lib/visual-template";

import { uploadStudioImage as uploadImage } from "@/lib/upload-studio-image";
import { isVisualImageUrl } from "./VisualStudioButton";
import { loadEditorFonts } from "./editor-fonts";
import { backgroundLayer, installBackground } from "./background-layer";
import VisualEditor from "./VisualEditor";
const button = "rounded-md border border-border bg-card px-4 py-2 font-semibold text-foreground disabled:opacity-50";
const input = "block w-full rounded-md border border-border bg-background p-2 text-foreground";
type FieldObject = FabricObject & { field?: string; text?: string };
export default function TemplateEditor({ admin = false, document: initial, name, channel, backgroundUrl, compact = false }: { admin?: boolean; document?: TemplateDocument; name?: string; channel?: string; backgroundUrl?: string; compact?: boolean }) {
  const element = useRef<HTMLCanvasElement>(null); const container = useRef<HTMLDivElement>(null); const canvas = useRef<Canvas | null>(null);
  const [title, setTitle] = useState(""); const [subject, setSubject] = useState(""); const [ready, setReady] = useState(false);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState("");
  const popup = useRef<Window | null>(null); const token = useRef("");
  useEffect(() => {
    if (admin || !initial || !element.current) return;
    const c = new Canvas(element.current, { selection: false, preserveObjectStacking: true }); c.on("object:modified", () => setSaved("")); canvas.current = c; let active = true;
    function fit() { if (!container.current) return; const width = Math.max(1, Math.min(initial!.width, container.current.clientWidth, Math.max(140, Math.min(window.innerHeight - Math.max(0, container.current.getBoundingClientRect().top) - 35, window.innerHeight * (compact ? .32 : .62))) * initial!.width / initial!.height)); c.setDimensions({ width, height: width * initial!.height / initial!.width }); c.setZoom(width / initial!.width); c.requestRenderAll(); }
    const observer = new ResizeObserver(fit); observer.observe(container.current!); window.addEventListener("resize", fit);
    void (async () => { try {
      await loadEditorFonts();
      await c.loadFromJSON(lockTemplate(initial)); if (!active) return;
      const photo = backgroundLayer(c) ?? c.backgroundImage;
      if (photo instanceof FabricImage) installBackground(c, photo);
      for (const object of c.getObjects() as FieldObject[]) { if (object.field === "title") setTitle(object.text ?? ""); if (object.field === "subject") setSubject(object.text ?? ""); }
      fit(); setReady(true);
    } catch { if (active) setMessage("Impossible de charger le template. Contactez un administrateur."); } })();
    return () => { active = false; observer.disconnect(); window.removeEventListener("resize", fit); canvas.current = null; void c.dispose(); };
  }, [admin, initial, compact]);
  function change(field: string, text: string) { const c = canvas.current; if (!c) return; for (const object of c.getObjects() as FieldObject[]) if (object.field === field) object.set({ text } as Partial<FabricObject>); c.requestRenderAll(); setSaved(""); }
  const background = useCallback(async (url: string) => {
    const c = canvas.current; if (!c || !initial) return; const image = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });
    if (image.width * image.height > 40_000_000) throw Error("Image trop grande : 40 mégapixels maximum.");
    const scale = Math.max(initial.width / image.width, initial.height / image.height);
    image.set({ originX: "left", originY: "top", left: (initial.width - image.width * scale) / 2, top: (initial.height - image.height * scale) / 2, scaleX: scale, scaleY: scale });
    installBackground(c, image); c.setActiveObject(image); c.requestRenderAll(); setSaved("");
  }, [initial]);
  useEffect(() => { function receive(event: MessageEvent) {
    if (event.origin !== window.location.origin || event.source !== popup.current || event.data?.channel !== token.current || event.data?.type !== "visual-studio:saved" || !isVisualImageUrl(event.data.url)) return;
    void run(async () => { await background(new URL(event.data.url, window.location.origin).href); setMessage("Fond chargé."); });
  } window.addEventListener("message", receive); return () => window.removeEventListener("message", receive); });
  const run = useCallback(async (action: () => Promise<void>) => { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "Opération impossible."); } finally { setBusy(false); } }, []);
  useEffect(() => { if (ready && backgroundUrl) void run(async () => { await background(new URL(backgroundUrl, window.location.origin).href); setMessage("Fond chargé."); }); }, [ready, backgroundUrl, background, run]);
  async function importFile(file: File) {
    if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("PNG, JPEG ou WebP de 5 Mo maximum.");
    const form = new FormData(); form.set("file", file); const result = await uploadImage(form); if (!result.ok) throw Error(result.error); await background(new URL(result.url, window.location.origin).href); setMessage("Fond chargé.");
  }
  async function exportFinal() {
    const c = canvas.current; if (!c) return; c.discardActiveObject(); c.requestRenderAll(); const output = c.toCanvasElement(1 / c.getZoom());
    const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, "image/png")); if (!blob) throw Error("Export impossible.");
    const form = new FormData(); form.set("file", new File([blob], "visual.png", { type: "image/png" })); const result = await uploadImage(form); if (!result.ok) throw Error(result.error);
    setSaved(result.url); setMessage("Visuel final enregistré.");
    if (channel && window.opener && !window.opener.closed) window.opener.postMessage({ type: "visual-studio:saved", channel, url: result.url }, window.location.origin);
  }
  if (admin) return <VisualEditor templateAdmin initialDocument={initial} initialName={name} />;
  return <div className="space-y-4"><p role="status" aria-live="polite">{message}</p>
    <fieldset disabled={!ready || busy} className="grid gap-4 rounded-xl border border-border p-4 md:grid-cols-2"><legend className="px-2 font-bold">{name}</legend>
      <label>Titre<textarea aria-label="Titre" rows={3} className={input} maxLength={200} value={title} onChange={event => { setTitle(event.target.value); change("title", event.target.value); }} /></label>
      <label>Sujet<input className={input} maxLength={100} value={subject} onChange={event => { setSubject(event.target.value); change("subject", event.target.value); }} /></label>
      {!compact && <button type="button" className={button} onClick={() => { token.current = crypto.randomUUID(); popup.current = window.open(`/studio/composer?channel=${token.current}`, "_blank"); if (!popup.current) setMessage("Autorisez l’ouverture du Compositeur dans un nouvel onglet."); }}>Composer un fond</button>}
      <label>Charger un fond<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; void run(() => importFile(file)) }} /></label>
      <button type="button" className={button} onClick={() => { const c = canvas.current; const photo = c && backgroundLayer(c); if (c && photo) { c.setActiveObject(photo); c.requestRenderAll(); } }}>Déplacer / redimensionner le fond</button>
      <p className="text-xs text-muted-foreground">Glissez la photo ou utilisez ses poignées. Le logo, les textes et les éléments du template restent verrouillés.</p>
      <button type="button" className={button} onClick={() => void run(exportFinal)}>Générer le visuel final</button>
    </fieldset>
    {!ready && <p role="status">Chargement du template…</p>}
    <div ref={container} onDragOver={event => { if (ready && !busy) event.preventDefault(); }} onDrop={event => { event.preventDefault(); if (!ready || busy) return; const file = event.dataTransfer.files[0]; if (file) { void run(() => importFile(file)); return; } const url = event.dataTransfer.getData("text/uri-list"); if (url) { try { const parsed = new URL(url, window.location.origin); const candidate = parsed.origin === window.location.origin ? parsed.pathname : parsed.href; if (isVisualImageUrl(candidate)) void run(() => background(parsed.href)); else setMessage("Glissez une image depuis votre ordinateur ou le fond enregistré du Compositeur."); } catch { setMessage("Lien d’image invalide."); } } }} className="flex min-w-0 justify-center overflow-hidden rounded-xl border-2 border-dashed border-border" aria-label="Déposer une image dans le fond du template"><canvas ref={element} aria-label="Aperçu du template verrouillé" /></div>
    {saved && <div><label>URL de l’image enregistrée<input className={input} readOnly value={saved} /></label><a href={saved} target="_blank" rel="noopener noreferrer" className="underline">Ouvrir le visuel final</a><button type="button" className={`${button} ml-3`} onClick={() => void navigator.clipboard.writeText(saved).then(() => setMessage("URL copiée."), () => setMessage("Copiez le lien du visuel."))}>Copier l’URL</button></div>}
  </div>;
}
