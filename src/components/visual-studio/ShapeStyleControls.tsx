"use client";

import { useEffect, useReducer } from "react";
import { Canvas, Color, FabricImage, FabricObject, Group, Textbox } from "fabric";

const control = "min-h-11 w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm text-foreground";

function shapes(object: FabricObject): FabricObject[] {
  if (object instanceof Group) return object.getObjects().flatMap(shapes);
  return object instanceof FabricImage || object instanceof Textbox ? [] : [object];
}
function hex(value: unknown, fallback: string) {
  return typeof value === "string" && value !== "transparent" ? `#${new Color(value).toHex()}` : fallback;
}

export default function ShapeStyleControls({ canvas, onChange }: { canvas: Canvas | null; onChange: () => void }) {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    if (!canvas) return;
    const dispose = [canvas.on("selection:created", refresh), canvas.on("selection:updated", refresh), canvas.on("selection:cleared", refresh), canvas.on("object:modified", refresh)];
    refresh();
    return () => dispose.forEach(off => off());
  }, [canvas]);
  const selected = canvas?.getActiveObject();
  const objects = selected ? shapes(selected) : [];
  const object = objects[0];
  const filled = objects.filter(item => item.type !== "line");
  const fill = filled[0]?.fill;
  const transparent = !fill || fill === "transparent" || fill === "rgba(0,0,0,0)";
  const width = object?.stroke ? object.strokeWidth : 0;
  const style = !width ? "none" : object?.strokeDashArray?.length ? (object.strokeDashArray[0] === 1 ? "dotted" : "dashed") : "solid";
  function apply(properties: Record<string, unknown>, targets = objects) {
    for (const item of targets) {
      item.set(properties); item.setCoords();
      let parent = item.group;
      while (parent) { parent.set("dirty", true); parent = parent.group; }
    }
    selected?.setCoords(); canvas?.requestRenderAll(); onChange(); refresh();
  }
  return <fieldset disabled={!objects.length} className="space-y-3 rounded-lg border border-border p-3 disabled:opacity-50">
    <legend className="px-1 text-sm font-bold">Apparence de la forme</legend>
    {!objects.length && <p className="text-xs text-muted-foreground">Sélectionnez une forme ou un séparateur sur le visuel ou dans les calques.</p>}
    <label className="block text-sm">Couleur de remplissage<input aria-label="Couleur de remplissage" className={control} type="color" disabled={!filled.length} value={hex(fill, "#ffffff")} onChange={event => apply({ fill: event.target.value }, filled)} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!filled.length} checked={transparent} onChange={event => apply({ fill: event.target.checked ? "transparent" : "#ffffff" }, filled)} />Sans remplissage</label>
    <label className="block text-sm">Couleur de bordure<input aria-label="Couleur de bordure" className={control} type="color" value={hex(object?.stroke, "#000000")} onChange={event => apply({ stroke: event.target.value, strokeWidth: width || 2, strokeUniform: true })} /></label>
    <label className="block text-sm">Épaisseur de bordure (px)<input aria-label="Épaisseur de bordure" className={control} type="number" min="0" max="100" step="1" value={width ?? 0} onChange={event => { const value = Math.max(0, Math.min(100, Number(event.target.value))); apply({ strokeWidth: value, stroke: value ? hex(object?.stroke, "#000000") : null, strokeUniform: true }); }} /></label>
    <label className="block text-sm">Style de bordure<select aria-label="Style de bordure" className={control} value={style} onChange={event => apply({ stroke: event.target.value === "none" ? null : hex(object?.stroke, "#000000"), strokeWidth: event.target.value === "none" ? 0 : width || 2, strokeUniform: true, strokeDashArray: event.target.value === "dashed" ? [12, 8] : event.target.value === "dotted" ? [1, 6] : null, strokeLineCap: event.target.value === "dotted" ? "round" : "butt" })}><option value="none">Aucune</option><option value="solid">Continue</option><option value="dashed">Tirets</option><option value="dotted">Pointillés</option></select></label>
  </fieldset>;
}
