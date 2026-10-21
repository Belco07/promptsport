"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, Textbox, Rect, Circle, Polygon, Group, FabricImage, FabricObject, filters } from "fabric";
import { saveVisualImage } from "@/app/studio/visual-studio/actions";

const TOP_LEFT = { originX: "left", originY: "top" } as const;
const FORMATS = [
  { label: "Article / X / Facebook — 1200 × 630", width: 1200, height: 630 },
  { label: "Instagram — 1080 × 1080", width: 1080, height: 1080 },
  { label: "Story — 1080 × 1920", width: 1080, height: 1920 },
];
const control = "w-full rounded-md border border-border bg-background p-2 text-sm text-foreground";
const button = "rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export default function VisualEditor({ channel }: { channel?: string }) {
  const element = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<Canvas | null>(null);
  const size = useRef(FORMATS[0]);
  const observer = useRef<ResizeObserver | null>(null);
  const [ready, setReady] = useState(false);
  const [format, setFormat] = useState(0);
  const [text, setText] = useState("Votre titre");
  const [font, setFont] = useState("Montserrat");
  const [fontSize, setFontSize] = useState(64);
  const [weight, setWeight] = useState("700");
  const [color, setColor] = useState("#ffffff");
  const [align, setAlign] = useState<Textbox["textAlign"]>("left");
  const [background, setBackground] = useState("#111410");
  const [unsplash, setUnsplash] = useState("");
  const [selected, setSelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [exportType, setExportType] = useState("image/png");

  function fit() {
    const c = canvas.current;
    if (!c || !container.current) return;
    const width = Math.max(180, Math.min(container.current.clientWidth, size.current.width));
    c.setDimensions({ width, height: width * size.current.height / size.current.width });
    c.setZoom(width / size.current.width);
    c.requestRenderAll();
  }
  useEffect(() => {
    const c = new Canvas(element.current!, { width: 1200, height: 630, backgroundColor: "#111410", preserveObjectStacking: true });
    canvas.current = c;
    function selection() {
      const object = c.getActiveObject();
      setSelected(Boolean(object));
      if (object instanceof Textbox) {
        setText(object.text); setFont(object.fontFamily); setFontSize(object.fontSize);
        setWeight(String(object.fontWeight)); setAlign(object.textAlign);
      }
      if (object && typeof object.fill === "string" && /^#[a-f0-9]{6}$/i.test(object.fill)) setColor(object.fill);
    }
    c.on("selection:created", selection); c.on("selection:updated", selection); c.on("selection:cleared", selection);
    c.on("text:changed", selection);
    const resize = new ResizeObserver(fit); observer.current = resize;
    resize.observe(container.current!); fit();
    let active = true;
    const face = new FontFace("Montserrat", "url(/fonts/Montserrat.ttf)", { weight: "100 900" });
    face.load().then(loaded => {
      if (active) { document.fonts.add(loaded); setReady(true); c.requestRenderAll(); }
    }).catch(() => { if (active) { setFont("Arial"); setReady(true); setError("Montserrat indisponible. La police Arial reste utilisable."); } });
    return () => { active = false; resize.disconnect(); canvas.current = null; void c.dispose(); };
  }, []);

  function update(properties: Record<string, string | number>) {
    const c = canvas.current; const object = c?.getActiveObject();
    if (!c || !object) return;
    object.set(properties); object.setCoords(); c.requestRenderAll(); setSaved("");
  }
  function add(object: FabricObject) {
    const c = canvas.current; if (!c) return;
    c.add(object); c.setActiveObject(object); c.requestRenderAll(); setSaved("");
  }
  function addText() {
    add(new Textbox(text || "Votre titre", { ...TOP_LEFT, left: 60, top: 60, width: size.current.width - 120, fontFamily: font, fontSize, fontWeight: weight, fill: color, textAlign: align }));
  }
  function setDimensions(index: number) {
    const c = canvas.current; if (!c) return;
    const next = FORMATS[index]; const previous = size.current;
    const scale = Math.min(next.width / previous.width, next.height / previous.height);
    for (const object of c.getObjects()) {
      object.set({ left: object.left * next.width / previous.width, top: object.top * next.height / previous.height, scaleX: object.scaleX * scale, scaleY: object.scaleY * scale }); object.setCoords();
    }
    size.current = next; setFormat(index); fitBackground(); fit(); setSaved("");
  }
  function fitBackground() {
    const c = canvas.current; const image = c?.backgroundImage;
    if (!c || !(image instanceof FabricImage)) return;
    const ratio = Math.max(size.current.width / image.width, size.current.height / image.height);
    image.set({ ...TOP_LEFT, scaleX: ratio, scaleY: ratio, left: (size.current.width - image.width * ratio) / 2, top: (size.current.height - image.height * ratio) / 2 });
  }
  async function loadImage(url: string, asBackground: boolean) {
    const c = canvas.current; if (!c) return;
    const image = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });
    if (canvas.current !== c) return;
    if (image.width * image.height > 40_000_000) throw Error("Image trop grande : maximum 40 mégapixels.");
    if (asBackground) { c.backgroundImage = image; fitBackground(); c.requestRenderAll(); }
    else { image.scaleToWidth(Math.min(size.current.width / 2, image.width)); image.set({ ...TOP_LEFT, left: 60, top: 60 }); add(image); }
    setSaved("");
  }
  async function fileImage(file: File | undefined, asBackground: boolean) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError("Choisissez un PNG, JPEG ou WebP de 5 Mo maximum."); return; }
    const url = URL.createObjectURL(file); setBusy(true); setError("");
    try { await loadImage(url, asBackground); } catch { setError("Impossible de charger cette image."); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  }
  async function remoteBackground() {
    try {
      const url = new URL(unsplash);
      if (url.protocol !== "https:" || url.hostname !== "images.unsplash.com" || url.username || url.password) throw Error();
      url.searchParams.set("w", "1600"); url.searchParams.set("fit", "max");
      setBusy(true); setError(""); await loadImage(url.toString(), true);
    } catch { setError("Collez l’adresse directe d’une image https://images.unsplash.com/… accessible à l’export."); }
    finally { setBusy(false); }
  }
  async function template(kind: string) {
    const c = canvas.current; if (!c) return;
    if (c.getObjects().length && !window.confirm("Remplacer la composition actuelle ?")) return;
    c.clear(); c.backgroundColor = "#111410"; setBackground("#111410");
    const w = size.current.width; const h = size.current.height;
    c.add(new Rect({ ...TOP_LEFT, left: 0, top: h * .55, width: w, height: h * .45, fill: "#070907", opacity: .88 }));
    c.add(new Rect({ ...TOP_LEFT, left: 48, top: h * .6, width: 120, height: 10, fill: "#d7ff00" }));
    c.add(new Textbox(kind === "mercato" ? "MERCATO" : kind === "match" ? "LE CHOC DU SOIR" : "À LA UNE", { ...TOP_LEFT, left: 48, top: h * .64, width: w - 96, fontFamily: font, fontSize: Math.round(w / 14), fontWeight: "900", fill: "#ffffff" }));
    c.add(new Textbox("Votre titre à personnaliser", { ...TOP_LEFT, left: 48, top: h * .84, width: w - 96, fontFamily: font, fontSize: Math.round(w / 32), fill: "#d7ff00" }));
    c.requestRenderAll(); setSaved("");
  }
  function filterBackground(value: string) {
    const c = canvas.current; const image = c?.backgroundImage;
    if (!c || !(image instanceof FabricImage)) { setError("Chargez d’abord une image de fond."); return; }
    image.filters = value === "gray" ? [new filters.Grayscale()] : value === "sepia" ? [new filters.Sepia()] : value === "contrast" ? [new filters.Contrast({ contrast: .25 })] : value === "dark" ? [new filters.Brightness({ brightness: -.25 })] : [];
    image.applyFilters(); c.requestRenderAll(); setSaved("");
  }
  async function exportImage(save: boolean) {
    const c = canvas.current; if (!c) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const output = c.toCanvasElement(1 / c.getZoom());
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(Error("Export impossible.")), exportType, .92));
      const extension = blob.type === "image/webp" ? "webp" : "png";
      if (!save) {
        const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `promptsport-${Date.now()}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (blob.size > 5 * 1024 * 1024) throw Error("Export supérieur à 5 Mo : essayez le format WebP.");
      const data = new FormData(); data.set("file", new File([blob], `visual.${extension}`, { type: blob.type }));
      const result = await saveVisualImage(data);
      if (!result.ok) throw Error(result.error);
      setSaved(result.url); setMessage("Image enregistrée. Vous pouvez copier son URL.");
      if (channel && window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "visual-studio:saved", channel, url: result.url }, window.location.origin);
        setMessage("Image enregistrée et envoyée à votre article. Enregistrez aussi l’article pour conserver l’insertion.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "L’enregistrement a échoué."); }
    finally { setBusy(false); }
  }
  return <div>
    {error && <p role="alert" className="mb-4 rounded-lg bg-status-error p-3 text-status-error-foreground">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-lg bg-status-success p-3 text-status-success-foreground">{message}</p>}
    <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <aside aria-label="Outils du Visual Studio" className="space-y-5 rounded-xl border border-border bg-card p-4">
        <fieldset disabled={!ready || busy} className="space-y-4 disabled:opacity-60">
          <legend className="mb-3 font-bold">Composition</legend>
          <label className="block text-sm">Format<select aria-label="Format du visuel" className={control} value={format} onChange={event => setDimensions(Number(event.target.value))}>{FORMATS.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}</select></label>
          <div><p className="mb-2 text-sm font-semibold">Modèles modifiables</p><div className="flex flex-wrap gap-2">{[["edito", "Édito"], ["mercato", "Mercato"], ["match", "Match"]].map(([value, label]) => <button type="button" className={button} key={value} onClick={() => template(value)}>{label}</button>)}</div></div>
          <label className="block text-sm">Couleur de fond<input aria-label="Couleur de fond" type="color" value={background} onChange={event => { setBackground(event.target.value); const c = canvas.current; if (c) { c.backgroundColor = event.target.value; c.requestRenderAll(); } }} /></label>
          <label className="block text-sm">Importer un fond<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void fileImage(event.target.files?.[0], true); event.target.value = ""; }} /></label>
          <div className="space-y-2"><a href="https://unsplash.com/fr/s/photos/football" target="_blank" rel="noopener noreferrer" className="text-sm text-editorial-link underline">Chercher sur Unsplash</a><label className="block text-sm">URL directe Unsplash<input className={control} type="url" value={unsplash} onChange={event => setUnsplash(event.target.value)} placeholder="https://images.unsplash.com/…" /></label><button type="button" className={button} onClick={remoteBackground}>Charger le fond Unsplash</button></div>
          <label className="block text-sm">Filtre du fond<select className={control} defaultValue="normal" onChange={event => filterBackground(event.target.value)}><option value="normal">Original</option><option value="gray">Noir et blanc</option><option value="sepia">Sépia</option><option value="contrast">Contraste</option><option value="dark">Assombrir</option></select></label>
          <label className="block text-sm">Image superposée (PNG transparent accepté)<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void fileImage(event.target.files?.[0], false); event.target.value = ""; }} /></label>
          <button type="button" className={button} onClick={async () => { setError(""); try { await loadImage("/promptsport-logo.webp", false); } catch { setError("Logo indisponible."); } }}>Ajouter le logo PromptSport</button>
        </fieldset>
        <fieldset disabled={!ready || busy} className="space-y-3 disabled:opacity-60">
          <legend className="mb-2 font-bold">Texte et formes</legend>
          <label className="block text-sm">Texte<textarea className={control} value={text} onChange={event => { setText(event.target.value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ text: event.target.value }); }} /></label>
          <label className="block text-sm">Police<select className={control} value={font} onChange={event => { setFont(event.target.value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontFamily: event.target.value }); }}>{["Montserrat", "Arial", "Georgia"].map(value => <option key={value}>{value}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">Taille<input className={control} type="number" min={12} max={240} value={fontSize} onChange={event => { const value = Math.max(12, Math.min(240, Number(event.target.value))); setFontSize(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontSize: value }); }} /></label><label className="text-sm">Graisse<select className={control} value={weight} onChange={event => { setWeight(event.target.value); update({ fontWeight: event.target.value }); }}><option value="400">Normal</option><option value="700">Gras</option><option value="900">Très gras</option></select></label></div>
          <label className="block text-sm">Alignement<select className={control} value={align} onChange={event => { setAlign(event.target.value as Textbox["textAlign"]); update({ textAlign: event.target.value }); }}><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select></label>
          <label className="block text-sm">Couleur du texte / de la forme<input aria-label="Couleur du texte ou de la forme" type="color" value={color} onChange={event => { setColor(event.target.value); update({ fill: event.target.value }); }} /></label>
          <button type="button" className={button} onClick={addText}>Ajouter le texte</button>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => add(new Rect({ ...TOP_LEFT, left: 80, top: 80, width: 300, height: 140, fill: color }))}>Rectangle</button>
            <button type="button" className={button} onClick={() => add(new Circle({ ...TOP_LEFT, left: 80, top: 80, radius: 90, fill: color }))}>Cercle</button>
            <button type="button" className={button} onClick={() => add(new Group([new Rect({ ...TOP_LEFT, width: 220, height: 20, top: 35, fill: color }), new Polygon([{ x: 0, y: 0 }, { x: 90, y: 45 }, { x: 0, y: 90 }], { ...TOP_LEFT, left: 200, top: 0, fill: color })], { ...TOP_LEFT, left: 80, top: 80 }))}>Flèche</button>
          </div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; const object = c?.getActiveObject(); if (c && object) { c.bringObjectForward(object); c.requestRenderAll(); } }}>Avancer</button><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; const object = c?.getActiveObject(); if (c && object) { c.sendObjectBackwards(object); c.requestRenderAll(); } }}>Reculer</button><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; if (c) { c.remove(...c.getActiveObjects()); c.discardActiveObject(); c.requestRenderAll(); } }}>Supprimer la sélection</button></div>
        </fieldset>
      </aside>
      <section aria-label="Composition et export" className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <label className="text-sm">Export<select aria-label="Format d’export" className={control} value={exportType} onChange={event => setExportType(event.target.value)}><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label>
          <button type="button" className={button} disabled={!ready || busy} onClick={() => exportImage(false)}>Télécharger</button>
          <button type="button" className="rounded-md bg-primary px-4 py-2 font-bold text-white disabled:opacity-50" disabled={!ready || busy} onClick={() => exportImage(true)}>{busy ? "Traitement en cours…" : "Enregistrer"}</button>
          <span className="text-xs text-muted-foreground">{FORMATS[format].width} × {FORMATS[format].height} px</span>
        </div>
        {!ready && <p role="status">Chargement du canvas et de Montserrat…</p>}
        <div ref={container} className="overflow-hidden rounded-lg border border-border bg-muted" aria-label="Zone de dessin"><canvas ref={element} aria-label="Canvas du visuel : sélectionnez et déplacez les éléments à la souris" /></div>
        <p className="mt-3 text-sm text-muted-foreground">Glissez les éléments pour les déplacer. Utilisez leurs poignées pour les redimensionner ou les tourner. Double-cliquez sur un texte pour l’éditer.</p>
        {saved && <div className="mt-4 space-y-2 rounded-xl border border-border bg-card p-4"><label className="block text-sm">URL de l’image enregistrée<input readOnly className={control} value={saved} /></label><button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(saved); setMessage("URL copiée."); } catch { setError("Copie indisponible : sélectionnez l’URL pour la copier."); } }}>Copier l’URL</button></div>}
      </section>
    </div>
  </div>;
}
