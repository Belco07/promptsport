"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas, Textbox, Rect, Circle, Polygon, Group, FabricImage, FabricObject, filters } from "fabric";

import { useRouter } from "next/navigation";
import UnsplashPicker from "./UnsplashPicker";
import { EDITOR_FONTS, fontWeights, loadEditorFonts } from "./editor-fonts";
import { backgroundLayer, installBackground } from "./background-layer";
import ShapePalette from "./ShapePalette";
import MontageTools from "./MontageTools";
import TemplateToolsPanel from "./TemplateToolsPanel";
import { saveVisualTemplate } from "@/app/studio/templates/actions";
import { uploadStudioImage as uploadImage } from "@/lib/upload-studio-image";
import { defaultVisualTemplate, type TemplateDocument } from "@/lib/visual-template";

const TOP_LEFT = { originX: "left", originY: "top" } as const;
const FORMATS = [
  { label: "Article / X / Facebook — 1200 × 630", width: 1200, height: 630 },
  { label: "Paysage 16:9 — 1920 × 1080", width: 1920, height: 1080 },
  { label: "Instagram — 1080 × 1080", width: 1080, height: 1080 },
  { label: "Story — 1080 × 1920", width: 1080, height: 1920 },
  { label: "Portrait éditorial — 1080 × 1350", width: 1080, height: 1350 },
];
const control = "min-h-11 w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm text-foreground";
const button = "min-h-11 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

export default function VisualEditor({ channel, composer = false, templateAdmin = false, initialDocument, initialName, initialTemplateId, initialMessage, compact = false, onSaved }: { channel?: string; composer?: boolean; templateAdmin?: boolean; initialDocument?: TemplateDocument; initialName?: string; initialTemplateId?: string; initialMessage?: string; compact?: boolean; onSaved?: (url: string) => void }) {
  const router = useRouter();
  const [logoVariant, setLogoVariant] = useState("white");
  const [templateName, setTemplateName] = useState(initialName ?? "Édition PromptSport");
  const initialTemplate = useRef(initialDocument);
  const element = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const toolsContainer = useRef<HTMLElement>(null);
  const canvas = useRef<Canvas | null>(null);
  const size = useRef(FORMATS[0]);
  const observer = useRef<ResizeObserver | null>(null);
  const [ready, setReady] = useState(false);
  const [format, setFormat] = useState(0);
  const [text, setText] = useState("Votre titre");
  const [font, setFont] = useState("Inter");
  const [italic, setItalic] = useState(false);
  const [lineHeight, setLineHeight] = useState(1.16);
  const [spacing, setSpacing] = useState(0);
  const [fontSize, setFontSize] = useState(64);
  const [weight, setWeight] = useState("700");
  const [color, setColor] = useState("#ffffff");
  const [align, setAlign] = useState<Textbox["textAlign"]>("left");
  const [background, setBackground] = useState("#111410");
  const [unsplash, setUnsplash] = useState("");
  const [selected, setSelected] = useState(false);
  const [, setLayerVersion] = useState(0);
  const [layerOpacity, setLayerOpacity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialMessage ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [exportType, setExportType] = useState("image/png");

  const fit = useCallback(() => {
    const c = canvas.current;
    if (!c || !container.current) return;
    if (templateAdmin && toolsContainer.current) {
      toolsContainer.current.style.maxHeight = window.innerWidth >= 1024 ? `${Math.max(120, window.innerHeight - toolsContainer.current.getBoundingClientRect().top - 16)}px` : "none";
    }
    const remaining = window.innerHeight - Math.max(0, container.current.getBoundingClientRect().top) - 65;
    const maxHeight = window.innerWidth < 1024 ? window.innerHeight * .55 : Math.max(60, Math.min(remaining, window.innerHeight * (compact ? .32 : .62)));
    const width = Math.max(1, Math.min(container.current.clientWidth, size.current.width, maxHeight * size.current.width / size.current.height));
    c.setDimensions({ width, height: width * size.current.height / size.current.width });
    c.setZoom(width / size.current.width);
    c.requestRenderAll();
  }, [compact, templateAdmin]);
  useEffect(() => {
    const c = new Canvas(element.current!, { width: 1200, height: 630, backgroundColor: "#111410", preserveObjectStacking: true });
    canvas.current = c;
    function selection() {
      const object = c.getActiveObject();
      setSelected(Boolean(object)); setLayerOpacity(object?.opacity ?? 1); setLayerVersion(value => value+1);
      if (object instanceof Textbox) {
        setItalic(object.fontStyle === "italic"); setLineHeight(object.lineHeight); setSpacing(object.charSpacing / 10);
        setText(object.text); setFont(object.fontFamily); setFontSize(object.fontSize);
        setWeight(String(object.fontWeight)); setAlign(object.textAlign);
      }
      if (object && typeof object.fill === "string" && /^#[a-f0-9]{6}$/i.test(object.fill)) setColor(object.fill);
    }
    c.on("selection:created", selection); c.on("selection:updated", selection); c.on("selection:cleared", selection);
    c.on("text:changed", selection);
    c.on("object:modified", () => setSaved(""));
    c.on("object:added", () => setLayerVersion(value => value+1)); c.on("object:removed", () => setLayerVersion(value => value+1));
    const resize = new ResizeObserver(fit); observer.current = resize;
    resize.observe(container.current!); window.addEventListener("resize", fit); fit();
    let active = true;
    loadEditorFonts().then(async () => {
      if (active) {
        if (initialTemplate.current) {
          const json = structuredClone(initialTemplate.current);
          function unlock(objects: Record<string, unknown>[]) { for (const object of objects) { Object.assign(object, { selectable: true, evented: true, editable: true, lockMovementX: false, lockMovementY: false, lockScalingX: false, lockScalingY: false, lockRotation: false }); if (Array.isArray(object.objects)) unlock(object.objects); } }
          unlock(json.objects); await c.loadFromJSON(json);
          if (c.backgroundImage instanceof FabricImage) installBackground(c, c.backgroundImage);
          size.current = { label: "Template", width: json.width, height: json.height };
          setFormat(Math.max(0, FORMATS.findIndex(item => item.width === json.width && item.height === json.height))); fit();
        }
        if (active) { setReady(true); c.requestRenderAll(); }
      }
    }).catch(() => { if (active) { setFont("Arial"); setReady(true); setError("Les polices sont indisponibles. Réessayez après avoir vérifié la connexion."); } });
    return () => { active = false; resize.disconnect(); window.removeEventListener("resize", fit); canvas.current = null; void c.dispose(); };
  }, [fit]);

  useLayoutEffect(() => { if (ready) fit(); }, [ready, fit, message, error, saved]);

  function update(properties: Record<string, string | number>) {
    const c = canvas.current; const object = c?.getActiveObject();
    if (!c || !object) return;
    if (typeof properties.fill === "string") {
      function recolor(item: FabricObject) {
        if (item instanceof Group) item.getObjects().forEach(recolor);
        else if (item.type === "line") item.set({ stroke: properties.fill as string });
        else if (!(item instanceof FabricImage)) item.set({ fill: properties.fill as string });
      }
      recolor(object);
      const rest = { ...properties }; delete rest.fill; object.set(rest);
    } else object.set(properties);
    object.setCoords(); c.requestRenderAll(); setSaved("");
  }
  function add(object: FabricObject) {
    const c = canvas.current; if (!c) return;
    c.add(object); c.setActiveObject(object); c.requestRenderAll(); setSaved("");
  }
  function addText() {
    add(new Textbox(text || "Votre titre", { ...TOP_LEFT, left: 60, top: 60, width: size.current.width - 120, fontFamily: font, fontSize, fontWeight: weight, fontStyle: italic ? "italic" : "normal", lineHeight, charSpacing: spacing * 10, fill: color, textAlign: align }));
  }
  function assignField(field: string) {
    const c = canvas.current; const object = c?.getActiveObject();
    if (!c || !(object instanceof Textbox)) { setError("Sélectionnez d’abord une zone de texte."); return; }
    for (const item of c.getObjects()) if ((item as FabricObject & { field?: string }).field === field) (item as FabricObject & { field?: string }).field = undefined;
    (object as Textbox & { field?: string }).field = field;
    setMessage(`Zone associée au champ ${field === "title" ? "Titre" : "Sujet"}.`);
  }
  async function saveTemplate(duplicate = false) {
    const c = canvas.current; if (!c) return;
    setBusy(true); setError("");
    try { const json = { ...c.toObject(["field", "assetRole"]), width: size.current.width, height: size.current.height };
      function portableImages(objects: Record<string, unknown>[]) { for (const object of objects) {
        if (typeof object.src === "string") { const url = new URL(object.src, window.location.origin); if (url.origin === window.location.origin) object.src = url.pathname + url.search; }
        if (Array.isArray(object.objects)) portableImages(object.objects);
      } }
      portableImages(json.objects); if (json.backgroundImage) portableImages([json.backgroundImage]);
      const result = await saveVisualTemplate(duplicate ? `${templateName.slice(0, 90)} — copie` : templateName, JSON.stringify(json), duplicate ? null : initialTemplateId ?? null); if (!result.ok) throw Error(result.error);
      setMessage("Template enregistré et verrouillé pour les journalistes.");
      router.replace(`/studio/templates?template=${encodeURIComponent(result.id)}&saved=1`, { scroll: false });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Enregistrement impossible."); } finally { setBusy(false); }
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
  async function collage(files: FileList | null) {
    if (!files?.length) return;
    const c = canvas.current; if (!c) return;
    const inputs = Array.from(files).slice(0, 8);
    if (inputs.some(file => !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) { setError("Images PNG, JPEG ou WebP de 5 Mo maximum."); return; }
    setBusy(true); setError("");
    const urls = inputs.map(file => URL.createObjectURL(file));
    try {
      const images = await Promise.all(urls.map(url => FabricImage.fromURL(url)));
      if (images.some(image => image.width * image.height > 40_000_000)) throw Error("Une image dépasse 40 mégapixels.");
      const columns = images.length === 2 ? 2 : Math.ceil(Math.sqrt(images.length));
      const rows = Math.ceil(images.length / columns);
      const width = size.current.width / columns, height = size.current.height / rows;
      images.forEach((image, index) => {
        const x = index % columns * width, y = Math.floor(index / columns) * height;
        const scale = Math.max(width / image.width, height / image.height);
        image.set({ ...TOP_LEFT, left: x + (width - image.width * scale) / 2, top: y + (height - image.height * scale) / 2, scaleX: scale, scaleY: scale,
          clipPath: new Rect({ ...TOP_LEFT, left: x + 3, top: y + 3, width: width - 6, height: height - 6, absolutePositioned: true }) });
        c.add(image);
      });
      c.requestRenderAll(); setSaved("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Import impossible."); }
    finally { urls.forEach(url => URL.revokeObjectURL(url)); setBusy(false); }
  }
  async function removeSelectedBackground() {
    const c = canvas.current; const image = c?.getActiveObject();
    if (!c || !(image instanceof FabricImage)) { setError("Sélectionnez une image superposée à détourer."); return; }
    setBusy(true); setError(""); setMessage("Détourage en cours : le premier chargement du modèle peut prendre quelques minutes.");
    let url = "";
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      // Feed untransformed pixels to the model; preserve the layer's rotation separately.
      const source = document.createElement("canvas"); const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
      source.width = Math.max(1, Math.round(image.width * scale)); source.height = Math.max(1, Math.round(image.height * scale));
      const context = source.getContext("2d"); if (!context) throw Error("Canvas indisponible.");
      context.drawImage(image.getElement(), 0, 0, source.width, source.height);
      const blob = await removeBackground(source.toDataURL("image/png"), { model: "isnet_quint8", output: { format: "image/png" }, progress: (_key, current, total) => { if (total > 0) setMessage(`Chargement du détourage : ${Math.round(current / total * 100)} %`); } });
      url = URL.createObjectURL(blob);
      const replacement = await FabricImage.fromURL(url);
      if (canvas.current !== c) return;
      replacement.set({ ...TOP_LEFT, left: image.left, top: image.top, angle: image.angle, scaleX: image.getScaledWidth() / replacement.width, scaleY: image.getScaledHeight() / replacement.height, clipPath: image.clipPath });
      const index = c.getObjects().indexOf(image); c.remove(image); c.insertAt(index, replacement); c.setActiveObject(replacement); c.requestRenderAll(); setSaved(""); setMessage("Image détourée.");
    } catch { setError("Détourage impossible. Vérifiez la connexion et réessayez avec une image plus petite."); setMessage(""); }
    finally { if (url) URL.revokeObjectURL(url); setBusy(false); }
  }
  function fitBackground() {
    const c = canvas.current; const image = c ? backgroundLayer(c) ?? c.backgroundImage : undefined;
    if (!c || !(image instanceof FabricImage)) return;
    const ratio = Math.max(size.current.width / image.width, size.current.height / image.height);
    image.set({ ...TOP_LEFT, scaleX: ratio, scaleY: ratio, left: (size.current.width - image.width * ratio) / 2, top: (size.current.height - image.height * ratio) / 2 });
  }
  async function loadImage(url: string, asBackground: boolean) {
    const c = canvas.current; if (!c) return;
    const image = await FabricImage.fromURL(url, { crossOrigin: "anonymous" });
    if (canvas.current !== c) return;
    if (image.width * image.height > 40_000_000) throw Error("Image trop grande : maximum 40 mégapixels.");
    if (asBackground) { installBackground(c, image); fitBackground(); c.setActiveObject(image); c.requestRenderAll(); }
    else { image.scaleToWidth(Math.min(size.current.width / 2, image.width)); image.set({ ...TOP_LEFT, left: 60, top: 60 }); add(image); }
    setSaved("");
  }
  async function fileImage(file: File | undefined, asBackground: boolean) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError("Choisissez un PNG, JPEG ou WebP de 5 Mo maximum."); return; }
    if (templateAdmin) {
      setBusy(true); setError("");
      try { const form = new FormData(); form.set("file", file); const result = await uploadImage(form); if (!result.ok) throw Error(result.error); await loadImage(result.url, asBackground); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Import impossible."); } finally { setBusy(false); }
      return;
    }
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
  async function replaceTemplateLogo(file?: File) {
    const c = canvas.current; if (!c) return;
    setBusy(true); setError("");
    try {
      let url = "/promptsport-logo.webp";
      if (file) { const form = new FormData(); form.set("file", file); const result = await uploadImage(form); if (!result.ok) throw Error(result.error); url = result.url; }
      const logo = await FabricImage.fromURL(url, { crossOrigin: "anonymous" }); if (canvas.current !== c) return;
      if (logo.width * logo.height > 40_000_000) throw Error("Logo trop grand : 40 mégapixels maximum.");
      const previous = c.getObjects().find(object => (object as FabricObject & { assetRole?: string }).assetRole === "logo" || (object instanceof FabricImage && /\/promptsport-logo(?:-night)?\.(webp|png)(?:$|\?)/.test(object.getSrc())));
      const width = previous?.getScaledWidth() ?? size.current.width * .21;
      const ratio = Math.min(width / logo.width, size.current.height * .1 / logo.height);
      logo.set({ ...TOP_LEFT, left: previous?.left ?? size.current.width - width - 40, top: previous?.top ?? 40, scaleX: ratio, scaleY: ratio });
      (logo as FabricImage & { assetRole: string }).assetRole = "logo";
      if (!file && logoVariant === "white") { logo.filters = [new filters.BlendColor({ color: "#ffffff", mode: "tint", alpha: 1 })]; logo.applyFilters(); }
      const index = previous ? c.getObjects().indexOf(previous) : c.getObjects().length;
      if (previous) c.remove(previous); c.insertAt(index, logo); c.setActiveObject(logo); c.requestRenderAll(); setSaved(""); setMessage(`${file ? "Logo personnalisé" : logoVariant === "white" ? "Logo PromptSport blanc" : "Logo PromptSport couleur"} appliqué. Enregistrez le template pour le conserver.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Import du logo impossible."); }
    finally { setBusy(false); }
  }
  async function editorialTemplate() {
    const c = canvas.current; if (!c) return;
    if (c.getObjects().length && !window.confirm("Remplacer les éléments du template ?")) return;
    setBusy(true); setError("");
    try {
      const doc = defaultVisualTemplate();
      for (const object of doc.objects) Object.assign(object, { selectable: true, evented: true, editable: true, lockMovementX: false, lockMovementY: false, lockScalingX: false, lockScalingY: false, lockRotation: false });
      const backgroundImage = backgroundLayer(c) ?? c.backgroundImage;
      await c.loadFromJSON(doc); if (canvas.current !== c) return;
      if (backgroundImage instanceof FabricImage) installBackground(c, backgroundImage);
      setDimensions(4); c.requestRenderAll(); setSaved("");
      setMessage("Template éditorial prêt : personnalisez la mise en page puis enregistrez-le.");
    } catch { setError("Impossible de charger le template éditorial."); }
    finally { setBusy(false); }
  }
  function filterBackground(value: string) {
    const c = canvas.current; const image = c ? backgroundLayer(c) ?? c.backgroundImage : undefined;
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
      const result = await uploadImage(data);
      if (!result.ok) throw Error(result.error);
      setSaved(result.url); onSaved?.(result.url); setMessage("Image enregistrée. Vous pouvez copier son URL.");
      if (channel && window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: "visual-studio:saved", channel, url: result.url }, window.location.origin);
        setMessage("Image enregistrée et envoyée à votre article. Enregistrez aussi l’article pour conserver l’insertion.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "L’enregistrement a échoué."); }
    finally { setBusy(false); }
  }
  return <div>
    {templateAdmin && <fieldset disabled={!ready || busy} className="mb-4 flex flex-col items-stretch gap-3 rounded-xl sm:flex-row sm:flex-wrap sm:items-end border border-border bg-card p-3"><legend className="px-2 text-sm font-bold">Enregistrement</legend><label className="min-w-0 flex-1 text-sm sm:min-w-48">Nom du template<input className={control} maxLength={100} value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><button type="button" className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void saveTemplate()}>Enregistrer le template</button><button type="button" className={button} onClick={() => void saveTemplate(true)}>Dupliquer ce template</button></fieldset>}
    {composer && <div className="mb-3"><label className="block rounded-lg border-2 border-dashed border-border p-3 text-sm font-bold">Importer depuis mon ordinateur<input className="mt-2 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" disabled={!ready || busy} onChange={event => { void fileImage(event.target.files?.[0], true); event.target.value = ""; }} /></label></div>}
    {error && <p role="alert" className="mb-4 rounded-lg bg-status-error p-3 text-status-error-foreground">{error}</p>}
    {message && <p role="status" className="mb-4 rounded-lg bg-status-success p-3 text-status-success-foreground">{message}</p>}
    <div className={compact ? "flex min-w-0 flex-col gap-3" : "grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]"}>
      <aside ref={toolsContainer} aria-label="Outils du Visual Studio" className={`space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-3 ${compact ? "order-2 lg:max-h-[28dvh]" : templateAdmin ? "order-2 lg:order-none lg:max-h-[calc(100dvh-300px)]" : "order-2 lg:order-none lg:max-h-[calc(100dvh-350px)]"}`}>
        {templateAdmin ? <TemplateToolsPanel disabled={!ready || busy} groups={[
          { id: "model", title: "Modèle et format", description: "Commencez avec la base éditoriale ou adaptez les dimensions.", content: <><button type="button" className={button} onClick={() => void editorialTemplate()}>Créer une base éditoriale</button>          <label className="block text-sm">Format<select aria-label="Format du visuel" className={control} value={format} onChange={event => setDimensions(Number(event.target.value))}>{FORMATS.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}</select></label></> },
          { id: "background", title: "Fond et dégradé", description: "Le journaliste remplacera la photo ; le dégradé reste dans le template.", content: <>          <label className="block text-sm">Couleur de fond<input aria-label="Couleur de fond" type="color" value={background} onChange={event => { setBackground(event.target.value); const c = canvas.current; if (c) { c.backgroundColor = event.target.value; c.requestRenderAll(); } }} /></label>          <label className="block text-sm">Importer un fond<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void fileImage(event.target.files?.[0], true); event.target.value = ""; }} /></label>          <button type="button" className={button} onClick={() => { const c = canvas.current; const image = c && backgroundLayer(c); if (c && image) { c.setActiveObject(image); c.requestRenderAll(); } }}>Déplacer / redimensionner le fond</button><button type="button" className={button} onClick={() => { fitBackground(); canvas.current?.requestRenderAll(); setSaved(""); }}>Recentrer le fond</button><label className="block text-sm">Filtre du fond<select aria-label="Filtre du fond" className={control} defaultValue="normal" onChange={event => filterBackground(event.target.value)}><option value="normal">Original</option><option value="gray">Noir et blanc</option><option value="sepia">Sépia</option><option value="contrast">Contraste</option><option value="dark">Assombrir</option></select></label><button type="button" className={button} onClick={() => { const c = canvas.current; const object = c?.getObjects().find(item => typeof item.fill === "object" && item.fill && "type" in item.fill && item.fill.type === "linear"); if (c && object) { c.setActiveObject(object); c.requestRenderAll(); } }}>Sélectionner le dégradé</button><label className="block text-sm">Opacité de la sélection<input aria-label="Opacité de la sélection" className="w-full" type="range" min="0" max="1" step="0.05" disabled={!selected} value={layerOpacity} onChange={event => { const value = Number(event.target.value); setLayerOpacity(value); update({ opacity: value }); }} /></label></> },
          { id: "branding", title: "Logo et images", description: "Choisissez le logo de marque et ajoutez vos éléments fixes.", content: <>          {templateAdmin ? <fieldset className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 font-bold">Logo du template</legend><label className="block text-sm">Version du logo<select aria-label="Version du logo" className={control} value={logoVariant} onChange={event => setLogoVariant(event.target.value)}><option value="color">PromptSport couleur</option><option value="white">PromptSport blanc</option></select></label><button type="button" className={button} onClick={() => void replaceTemplateLogo()}>Appliquer le logo PromptSport</button><label className="block text-sm">Importer un logo personnalisé<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void replaceTemplateLogo(file); }} /></label></fieldset> : <button type="button" className={button} onClick={async () => { setBusy(true); setError(""); try { await loadImage("/promptsport-logo.webp", false); } catch { setError("Logo indisponible."); } finally { setBusy(false); } }}>Ajouter le logo PromptSport</button>}          <label className="block text-sm">Image superposée (PNG transparent accepté)<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void fileImage(event.target.files?.[0], false); event.target.value = ""; }} /></label></> },
          { id: "text", title: "Textes", description: "Titre et sujet seront modifiables ; leurs styles et positions restent fixes.", content: <><div className="grid grid-cols-2 gap-2"><button type="button" className={button} onClick={() => { const c = canvas.current; const object = c?.getObjects().find(item => (item as FabricObject & { field?: string }).field === "title"); if (c && object) { c.setActiveObject(object); c.requestRenderAll(); } }}>Sélectionner Titre</button><button type="button" className={button} onClick={() => { const c = canvas.current; const object = c?.getObjects().find(item => (item as FabricObject & { field?: string }).field === "subject"); if (c && object) { c.setActiveObject(object); c.requestRenderAll(); } }}>Sélectionner Sujet</button></div>          <label className="block text-sm">Texte<textarea aria-label="Texte" className={control} value={text} onChange={event => { setText(event.target.value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ text: event.target.value }); }} /></label>
          <label className="block text-sm">Police<select aria-label="Police" className={control} value={font} onChange={event => { const family = event.target.value; const nextWeight = String(Math.min(Math.max(Number(weight), fontWeights(family)[0]), fontWeights(family).at(-1)!)); setFont(family); setWeight(nextWeight); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontFamily: family, fontWeight: nextWeight }); }}>{[...EDITOR_FONTS, ...(EDITOR_FONTS.includes(font as typeof EDITOR_FONTS[number]) ? [] : [font])].map(value => <option key={value} style={{ fontFamily: value }}>{value}</option>)}</select></label><p aria-hidden="true" className="truncate text-lg" style={{fontFamily:font,fontWeight:weight,fontStyle:italic ? "italic" : "normal"}}>Le sport fait la Une</p>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">Taille<input className={control} type="number" min={1} max={1000} value={fontSize} onChange={event => { const value = Math.max(1, Math.min(1000, Number(event.target.value))); setFontSize(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontSize: value }); }} /></label><label className="text-sm">Graisse<select aria-label="Graisse" className={control} value={weight} onChange={event => { setWeight(event.target.value); update({ fontWeight: event.target.value }); }}>{fontWeights(font).map(value => <option key={value} value={value}>{value} — {({100:"Très fin",200:"Extra léger",300:"Léger",400:"Normal",500:"Moyen",600:"Demi-gras",700:"Gras",800:"Extra gras",900:"Noir"} as Record<number,string>)[value]}</option>)}</select></label></div>
          <label className="block text-sm">Casse<select aria-label="Casse du texte" className={control} defaultValue="" onChange={event => { const mode = event.target.value; const next = mode === "lower" ? text.toLocaleLowerCase("fr") : mode === "upper" ? text.toLocaleUpperCase("fr") : mode === "title" ? text.toLocaleLowerCase("fr").replace(/(^|[\s’'-])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase("fr")) : text; setText(next); if (canvas.current?.getActiveObject() instanceof Textbox) update({ text: next }); event.target.value = ""; }}><option value="">Transformer le texte…</option><option value="lower">minuscules</option><option value="upper">MAJUSCULES</option><option value="title">Initiales En Capitales</option></select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={italic} onChange={event => { setItalic(event.target.checked); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontStyle: event.target.checked ? "italic" : "normal" }); }} />Italique</label>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">Interligne<input aria-label="Interligne" className={control} type="number" min="0.5" max="4" step="0.05" value={lineHeight} onChange={event => { const value = Math.max(.5, Math.min(4, Number(event.target.value))); setLineHeight(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ lineHeight: value }); }} /></label><label className="text-sm">Espacement (%)<input aria-label="Espacement des caractères" className={control} type="number" min="-10" max="100" step="0.5" value={spacing} onChange={event => { const value = Math.max(-10, Math.min(100, Number(event.target.value))); setSpacing(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ charSpacing: value * 10 }); }} /></label></div>
          <label className="block text-sm">Alignement<select aria-label="Alignement" className={control} value={align} onChange={event => { setAlign(event.target.value as Textbox["textAlign"]); update({ textAlign: event.target.value }); }}><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select></label>
          <label className="block text-sm">Couleur du texte / de la forme<input aria-label="Couleur du texte ou de la forme" type="color" value={color} onChange={event => { setColor(event.target.value); update({ fill: event.target.value }); }} /></label>
          <button type="button" className={button} onClick={addText}>Ajouter le texte</button>
<div className="grid gap-2"><button type="button" className={button} onClick={() => assignField("title")}>Utiliser la sélection comme Titre</button><button type="button" className={button} onClick={() => assignField("subject")}>Utiliser la sélection comme Sujet</button></div></> },
          { id: "layers", title: "Formes et calques", description: "Sélectionnez un élément, changez son ordre ou supprimez-le.", content: <><ol className="space-y-1">{[...(canvas.current?.getObjects() ?? [])].reverse().map((object,index) => <li key={index}><button type="button" aria-pressed={canvas.current?.getActiveObject() === object} className={button+" w-full text-left"} onClick={() => { canvas.current?.setActiveObject(object); canvas.current?.requestRenderAll(); }}>{object instanceof Textbox ? object.text.slice(0,35) : object instanceof FabricImage ? "Image / logo" : "Forme / dégradé"}</button></li>)}</ol>          <ShapePalette color={color} onAdd={add} /><div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => add(new Rect({ ...TOP_LEFT, left: 80, top: 80, width: 300, height: 140, fill: color }))}>Rectangle</button>
            <button type="button" className={button} onClick={() => add(new Circle({ ...TOP_LEFT, left: 80, top: 80, radius: 90, fill: color }))}>Cercle</button>
            <button type="button" className={button} onClick={() => add(new Group([new Rect({ ...TOP_LEFT, width: 220, height: 20, top: 35, fill: color }), new Polygon([{ x: 0, y: 0 }, { x: 90, y: 45 }, { x: 0, y: 90 }], { ...TOP_LEFT, left: 200, top: 0, fill: color })], { ...TOP_LEFT, left: 80, top: 80 }))}>Flèche</button>
          </div>          <div className="flex flex-wrap gap-2"><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; const object = c?.getActiveObject(); if (c && object) { c.bringObjectForward(object); c.requestRenderAll(); } }}>Avancer</button><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; const object = c?.getActiveObject(); if (c && object) { c.sendObjectBackwards(object); c.requestRenderAll(); } }}>Reculer</button><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; if (c) { c.remove(...c.getActiveObjects()); c.discardActiveObject(); c.requestRenderAll(); } }}>Supprimer la sélection</button></div></> },
        ]} /> : <>
        <TemplateToolsPanel disabled={!ready || busy} introduction="Composez votre image par étapes, puis appliquez-la au template dans la colonne de droite." groups={[
{ id: "model", title: "Format et fond", description: "Choisissez les dimensions et importez votre photo.", content: <>          <label className="block text-sm">Format<select aria-label="Format du visuel" className={control} value={format} onChange={event => setDimensions(Number(event.target.value))}>{FORMATS.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}</select></label>
          <div><p className="mb-2 text-sm font-semibold">Modèles modifiables</p><div className="flex flex-wrap gap-2">{[["edito", "Édito"], ["mercato", "Mercato"], ["match", "Match"]].map(([value, label]) => <button type="button" className={button} key={value} onClick={() => template(value)}>{label}</button>)}</div></div>
          <label className="block text-sm">Couleur de fond<input aria-label="Couleur de fond" type="color" value={background} onChange={event => { setBackground(event.target.value); const c = canvas.current; if (c) { c.backgroundColor = event.target.value; c.requestRenderAll(); } }} /></label>
          <label className="block text-sm">Importer un fond<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void fileImage(event.target.files?.[0], true); event.target.value = ""; }} /></label>
          <div className="space-y-2"><a href="https://unsplash.com/fr/s/photos/football" target="_blank" rel="noopener noreferrer" className="text-sm text-editorial-link underline">Chercher sur Unsplash</a><label className="block text-sm">URL directe Unsplash<input className={control} type="url" value={unsplash} onChange={event => setUnsplash(event.target.value)} placeholder="https://images.unsplash.com/…" /></label><button type="button" className={button} onClick={remoteBackground}>Charger le fond Unsplash</button></div>
          <button type="button" className={button} onClick={() => { const c = canvas.current; const image = c && backgroundLayer(c); if (c && image) { c.setActiveObject(image); c.requestRenderAll(); } }}>Déplacer / redimensionner le fond</button><button type="button" className={button} onClick={() => { fitBackground(); canvas.current?.requestRenderAll(); setSaved(""); }}>Recentrer le fond</button><label className="block text-sm">Filtre du fond<select aria-label="Filtre du fond" className={control} defaultValue="normal" onChange={event => filterBackground(event.target.value)}><option value="normal">Original</option><option value="gray">Noir et blanc</option><option value="sepia">Sépia</option><option value="contrast">Contraste</option><option value="dark">Assombrir</option></select></label>
</> },
{ id: "images", title: "Images et détourage", description: "Ajoutez vos images, assemblez un collage et détourez vos sujets.", content: <>          {composer && <UnsplashPicker onImage={url => loadImage(url, false)} />}
          {composer && <button type="button" className={button} disabled={!selected} onClick={() => void removeSelectedBackground()}>Détourer l’image sélectionnée</button>}
          {composer && <label className="block text-sm">Collage / mosaïque (8 images maximum)<input type="file" multiple accept="image/png,image/jpeg,image/webp" className="mt-2 w-full text-xs" onChange={event => { void collage(event.target.files); event.target.value = ""; }} /></label>}
          <label className="block text-sm">Image superposée (PNG transparent accepté)<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { void fileImage(event.target.files?.[0], false); event.target.value = ""; }} /></label>
          {templateAdmin ? <fieldset className="space-y-2 rounded-lg border border-border p-3"><legend className="px-1 font-bold">Logo du template</legend><label className="block text-sm">Version du logo<select aria-label="Version du logo" className={control} value={logoVariant} onChange={event => setLogoVariant(event.target.value)}><option value="color">PromptSport couleur</option><option value="white">PromptSport blanc</option></select></label><button type="button" className={button} onClick={() => void replaceTemplateLogo()}>Appliquer le logo PromptSport</button><label className="block text-sm">Importer un logo personnalisé<input className="mt-1 w-full text-xs" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void replaceTemplateLogo(file); }} /></label></fieldset> : <button type="button" className={button} onClick={async () => { setBusy(true); setError(""); try { await loadImage("/promptsport-logo.webp", false); } catch { setError("Logo indisponible."); } finally { setBusy(false); } }}>Ajouter le logo PromptSport</button>}</> },
{ id: "text", title: "Textes et typographie", description: "Réglez police, graisse, casse et espacement.", content: <>          <label className="block text-sm">Texte<textarea aria-label="Texte" className={control} value={text} onChange={event => { setText(event.target.value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ text: event.target.value }); }} /></label>
          <label className="block text-sm">Police<select aria-label="Police" className={control} value={font} onChange={event => { const family = event.target.value; const nextWeight = String(Math.min(Math.max(Number(weight), fontWeights(family)[0]), fontWeights(family).at(-1)!)); setFont(family); setWeight(nextWeight); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontFamily: family, fontWeight: nextWeight }); }}>{[...EDITOR_FONTS, ...(EDITOR_FONTS.includes(font as typeof EDITOR_FONTS[number]) ? [] : [font])].map(value => <option key={value} style={{ fontFamily: value }}>{value}</option>)}</select></label><p aria-hidden="true" className="truncate text-lg" style={{fontFamily:font,fontWeight:weight,fontStyle:italic ? "italic" : "normal"}}>Le sport fait la Une</p>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">Taille<input className={control} type="number" min={1} max={1000} value={fontSize} onChange={event => { const value = Math.max(1, Math.min(1000, Number(event.target.value))); setFontSize(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontSize: value }); }} /></label><label className="text-sm">Graisse<select aria-label="Graisse" className={control} value={weight} onChange={event => { setWeight(event.target.value); update({ fontWeight: event.target.value }); }}>{fontWeights(font).map(value => <option key={value} value={value}>{value} — {({100:"Très fin",200:"Extra léger",300:"Léger",400:"Normal",500:"Moyen",600:"Demi-gras",700:"Gras",800:"Extra gras",900:"Noir"} as Record<number,string>)[value]}</option>)}</select></label></div>
          <label className="block text-sm">Casse<select aria-label="Casse du texte" className={control} defaultValue="" onChange={event => { const mode = event.target.value; const next = mode === "lower" ? text.toLocaleLowerCase("fr") : mode === "upper" ? text.toLocaleUpperCase("fr") : mode === "title" ? text.toLocaleLowerCase("fr").replace(/(^|[\s’'-])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toLocaleUpperCase("fr")) : text; setText(next); if (canvas.current?.getActiveObject() instanceof Textbox) update({ text: next }); event.target.value = ""; }}><option value="">Transformer le texte…</option><option value="lower">minuscules</option><option value="upper">MAJUSCULES</option><option value="title">Initiales En Capitales</option></select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={italic} onChange={event => { setItalic(event.target.checked); if (canvas.current?.getActiveObject() instanceof Textbox) update({ fontStyle: event.target.checked ? "italic" : "normal" }); }} />Italique</label>
          <div className="grid grid-cols-2 gap-2"><label className="text-sm">Interligne<input aria-label="Interligne" className={control} type="number" min="0.5" max="4" step="0.05" value={lineHeight} onChange={event => { const value = Math.max(.5, Math.min(4, Number(event.target.value))); setLineHeight(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ lineHeight: value }); }} /></label><label className="text-sm">Espacement (%)<input aria-label="Espacement des caractères" className={control} type="number" min="-10" max="100" step="0.5" value={spacing} onChange={event => { const value = Math.max(-10, Math.min(100, Number(event.target.value))); setSpacing(value); if (canvas.current?.getActiveObject() instanceof Textbox) update({ charSpacing: value * 10 }); }} /></label></div>
          <label className="block text-sm">Alignement<select aria-label="Alignement" className={control} value={align} onChange={event => { setAlign(event.target.value as Textbox["textAlign"]); update({ textAlign: event.target.value }); }}><option value="left">Gauche</option><option value="center">Centre</option><option value="right">Droite</option></select></label>
          <label className="block text-sm">Couleur du texte / de la forme<input aria-label="Couleur du texte ou de la forme" type="color" value={color} onChange={event => { setColor(event.target.value); update({ fill: event.target.value }); }} /></label>
          <button type="button" className={button} onClick={addText}>Ajouter le texte</button>
</> },
{ id: "stickers", title: "Formes et stickers", description: "Ajoutez des éléments graphiques à votre montage.", content: <>          <div className="flex flex-wrap gap-2" aria-label="Stickers">{["⚽", "🏆", "🔥", "⭐", "💥", "🏀", "🥇", "🥈", "🥉", "🎯", "🚨", "🔴", "🟡", "🟢", "🔵", "⚪", "⚫", "✅", "❌", "🔁", "✍️", "💰", "⏱️", "📣", "💪", "👏", "🙌", "😱", "😎", "❤️", "💔", "🏟️", "🎾", "🏉", "🥊", "🏁"].map(emoji => <button type="button" key={emoji} className={button} aria-label={`Ajouter ${emoji}`} onClick={() => add(new Textbox(emoji, { ...TOP_LEFT, left: 80, top: 80, width: 140, fontSize: 100, fontFamily: "Arial" }))}>{emoji}</button>)}</div>
          <ShapePalette color={color} onAdd={add} /><div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => add(new Rect({ ...TOP_LEFT, left: 80, top: 80, width: 300, height: 140, fill: color }))}>Rectangle</button>
            <button type="button" className={button} onClick={() => add(new Circle({ ...TOP_LEFT, left: 80, top: 80, radius: 90, fill: color }))}>Cercle</button>
            <button type="button" className={button} onClick={() => add(new Group([new Rect({ ...TOP_LEFT, width: 220, height: 20, top: 35, fill: color }), new Polygon([{ x: 0, y: 0 }, { x: 90, y: 45 }, { x: 0, y: 90 }], { ...TOP_LEFT, left: 200, top: 0, fill: color })], { ...TOP_LEFT, left: 80, top: 80 }))}>Flèche</button>
          </div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; const object = c?.getActiveObject(); if (c && object) { c.bringObjectForward(object); c.requestRenderAll(); } }}>Avancer</button><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; const object = c?.getActiveObject(); if (c && object) { c.sendObjectBackwards(object); c.requestRenderAll(); } }}>Reculer</button><button type="button" disabled={!selected} className={button} onClick={() => { const c = canvas.current; if (c) { c.remove(...c.getActiveObjects()); c.discardActiveObject(); c.requestRenderAll(); } }}>Supprimer la sélection</button></div></> },
{ id: "layers", title: "Calques et finitions", description: "Sélectionnez vos éléments et ajustez leurs effets.", content: <>        {ready && composer && canvas.current && <MontageTools canvas={canvas.current} onChange={() => setSaved("")} />}</> },
        ]} />
</>}
      </aside>
      <section aria-label="Composition et export" className="min-w-0 self-start w-full lg:order-none">
        {templateAdmin ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"><div><p className="text-sm font-bold">Aperçu du template</p><p className="text-xs text-muted-foreground">{size.current.width} × {size.current.height} px</p></div><button type="button" className={button} disabled={!ready || busy} onClick={() => void exportImage(false)}>Télécharger un aperçu</button></div> : <>        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3">
          <label className="text-sm">Export<select aria-label="Format d’export" className={control} value={exportType} onChange={event => setExportType(event.target.value)}><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></label>
          <button type="button" className={button} disabled={!ready || busy} onClick={() => exportImage(false)}>Télécharger</button>
          <button type="button" className="rounded-md bg-primary px-4 py-2 font-bold text-white disabled:opacity-50" disabled={!ready || busy} onClick={() => exportImage(true)}>{busy ? "Traitement en cours…" : composer ? "Enregistrer le fond" : "Enregistrer"}</button>
          <span className="text-xs text-muted-foreground">{size.current.width} × {size.current.height} px</span>
        </div></>}
        {!ready && <p role="status">Chargement du canvas et des polices…</p>}
        <div ref={container} className="flex justify-center overflow-hidden rounded-lg border border-border bg-muted" aria-label="Zone de dessin"><canvas ref={element} aria-label="Canvas du visuel : sélectionnez et déplacez les éléments à la souris" /></div>
        <p className="mt-3 text-sm text-muted-foreground">Glissez les éléments pour les déplacer. Utilisez leurs poignées pour les redimensionner ou les tourner. Double-cliquez sur un texte pour l’éditer.</p>
        {saved && <div className="mt-4 space-y-2 rounded-xl border border-border bg-card p-4"><label className="block text-sm">URL de l’image enregistrée<input readOnly className={control} value={saved} /></label><button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(saved); setMessage("URL copiée."); } catch { setError("Copie indisponible : sélectionnez l’URL pour la copier."); } }}>Copier l’URL</button></div>}
      </section>
    </div>
  </div>;
}
