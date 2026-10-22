export type TemplateElement = { type: string; field?: string; text?: string; objects?: TemplateElement[]; [key: string]: unknown };
export type TemplateDocument = { width: number; height: number; objects: TemplateElement[]; [key: string]: unknown };

export const DEFAULT_TEMPLATE_NAME = "Éditorial — Portrait";

/** Editable source for admins, immutable layout for journalists. No database seed needed. */
export function defaultVisualTemplate(): TemplateDocument {
  const position = { originX: "left", originY: "top" };
  return lockTemplate({
    width: 1080, height: 1350, background: "#202423",
    objects: [
      { type: "Rect", ...position, left: 0, top: 380, width: 1080, height: 970, fill: {
        type: "linear", gradientUnits: "pixels", coords: { x1: 0, y1: 0, x2: 0, y2: 970 },
        colorStops: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: .5, color: "rgba(0,0,0,.75)" }, { offset: 1, color: "#000000" }],
      } },
      { type: "Image", assetRole: "logo", filters: [{ type: "BlendColor", color: "#ffffff", mode: "tint", alpha: 1 }], ...position, left: 815, top: 42, width: 900, height: 198, scaleX: .25, scaleY: .25, src: "/promptsport-logo.webp", crossOrigin: "anonymous" },
      { type: "Textbox", ...position, field: "title", text: "VOTRE GRAND TITRE\nSUR TROIS LIGNES\nÀ PERSONNALISER", left: 55, top: 660, width: 970, fontFamily: "Barlow Condensed", fontWeight: "700", fontSize: 112, lineHeight: 1, textAlign: "center", fill: "#ffffff" },
      { type: "Rect", ...position, left: 225, top: 1130, width: 630, height: 68, rx: 10, ry: 10, fill: "#1235ff", stroke: "#ffffff", strokeWidth: 3 },
      { type: "Textbox", ...position, field: "subject", text: "FOOTBALL", left: 240, top: 1140, width: 600, fontFamily: "Montserrat", fontWeight: "400", fontSize: 40, textAlign: "center", fill: "#ffffff" },
    ],
  });
}

export function lockTemplate(document: TemplateDocument): TemplateDocument {
  const result = structuredClone(document);
  function lock(elements: TemplateElement[]) { for (const element of elements) {
    Object.assign(element, { selectable: false, evented: false, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true, editable: false });
    if (element.objects) lock(element.objects);
  } }
  lock(result.objects); return result;
}
export function validateTemplate(value: unknown): value is TemplateDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as TemplateDocument;
  if (!Number.isFinite(doc.width) || !Number.isFinite(doc.height) || doc.width < 200 || doc.height < 200 || doc.width > 4096 || doc.height > 4096 || !Array.isArray(doc.objects)) return false;
  let count = 0;
  function valid(elements: TemplateElement[]): boolean { return elements.every(element => {
    if (++count > 150 || !element || typeof element !== "object" || typeof element.type !== "string" || !["textbox", "text", "i-text", "image", "rect", "circle", "polygon", "group", "line", "path", "triangle", "ellipse"].includes(element.type.toLowerCase())) return false;
    if (element.type.toLowerCase() === "image") {
      if (typeof element.src !== "string") return false;
      try { const url = new URL(element.src, "https://www.promptsport.net"); if (url.protocol !== "https:" || url.username || url.password) return false; } catch { return false; }
    }
    return !element.objects || (Array.isArray(element.objects) && valid(element.objects));
  }); }
  return valid(doc.objects);
}
