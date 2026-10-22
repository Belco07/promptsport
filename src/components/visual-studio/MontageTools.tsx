"use client";

import { useEffect, useState } from "react";
import { Canvas, FabricImage, FabricObject, Textbox, Shadow, filters } from "fabric";

import { backgroundLayer } from "./background-layer";

const button = "rounded border border-border px-2 py-1 text-sm disabled:opacity-50";

/** Operates on individual source layers; exports preserve all effects. */
export default function MontageTools({ canvas, onChange }: { canvas: Canvas; onChange: () => void }) {
  const [layers, setLayers] = useState<FabricObject[]>([]);
  const [selected, setSelected] = useState<FabricObject>();
  const [targetBackground, setTargetBackground] = useState(false);
  const [, refresh] = useState(0);
  useEffect(() => {
    const sync = () => {
      const next = canvas.getObjects();
      setLayers(previous => previous.length === next.length && previous.every((object,index) => object === next[index]) ? previous : next);
      setSelected(canvas.getActiveObject());
    };
    canvas.on("after:render", sync); sync();
    return () => { canvas.off("after:render", sync); };
  }, [canvas]);
  const target = targetBackground ? backgroundLayer(canvas) ?? canvas.backgroundImage : selected;
  const image = target instanceof FabricImage ? target : undefined;
  function changed() { canvas.requestRenderAll(); refresh(value => value+1); onChange(); }
  function apply(type: "Brightness" | "Contrast" | "Saturation", value: number) {
    if (!image) return;
    const property = type === "Brightness" ? "brightness" : type === "Contrast" ? "contrast" : "saturation";
    image.filters = image.filters.filter(filter => filter.type !== type);
    if (value) image.filters.push(new filters[type]({ [property]: value }));
    image.applyFilters(); changed();
  }
  function filterValue(type: string, property: string) {
    const filter = image?.filters.find(filter => filter.type === type);
    return filter ? Number((filter as unknown as Record<string, unknown>)[property] ?? 0) : 0;
  }
  return <fieldset className="space-y-3 rounded border border-border p-3">
    <legend className="px-1 font-bold">Calques et finitions</legend>
    <p className="text-xs text-muted-foreground">Du premier plan au dernier plan. Sélectionnez un élément pour le régler.</p>
    <ol className="max-h-48 space-y-1 overflow-auto">
      {[...layers].reverse().map((object,index) => <li key={layers.indexOf(object)}>
        <button type="button" className={`${button} w-full text-left ${selected === object ? "bg-muted font-bold" : ""}`} aria-pressed={selected === object && !targetBackground} onClick={() => { setTargetBackground(false); canvas.setActiveObject(object); canvas.requestRenderAll(); }}>
          {object instanceof Textbox ? object.text.slice(0,35) : object instanceof FabricImage ? "Image" : "Forme"} · calque {layers.length-index}
        </button>
      </li>)}
    </ol>
    <button type="button" className={button} aria-pressed={targetBackground} disabled={!backgroundLayer(canvas) && !canvas.backgroundImage} onClick={() => setTargetBackground(value => !value)}>Régler le fond</button>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={!selected || targetBackground} onClick={() => { if (selected) canvas.bringObjectToFront(selected); changed(); }}>Tout devant</button>
      <button type="button" className={button} disabled={!selected || targetBackground} onClick={() => { if (selected) canvas.sendObjectToBack(selected); changed(); }}>Tout derrière</button>
    </div>
    <label className="block text-sm">Opacité<input className="w-full" type="range" min="0" max="1" step="0.05" disabled={!target} value={target?.opacity ?? 1} onChange={event => { target?.set({ opacity: Number(event.target.value) }); changed(); }} /></label>
    {([['Brightness','brightness','Luminosité'],['Contrast','contrast','Contraste'],['Saturation','saturation','Saturation']] as const).map(([type,property,label]) => <label key={type} className="block text-sm">{label}<input className="w-full" type="range" min="-1" max="1" step="0.05" disabled={!image} value={filterValue(type,property)} onChange={event => apply(type, Number(event.target.value))} /></label>)}
    <label className="block text-sm">Effet de détachement<select aria-label="Effet de détachement" className="mt-1 w-full rounded border border-border bg-background p-2" disabled={!target} value={!target?.shadow ? "none" : target.shadow.color === "#ffffff" ? "halo" : "shadow"} onChange={event => {
      target?.set({ shadow: event.target.value === "none" ? null : new Shadow({ color: event.target.value === "halo" ? "#ffffff" : "#000000", blur: event.target.value === "halo" ? 12 : 25, offsetX: 0, offsetY: event.target.value === "halo" ? 0 : 10 }) }); changed();
    }}><option value="none">Aucun</option><option value="shadow">Ombre portée</option><option value="halo">Halo clair</option></select></label>
  </fieldset>;
}
