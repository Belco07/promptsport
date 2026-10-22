export type TemplateElement = { type: string; field?: string; text?: string; objects?: TemplateElement[]; [key: string]: unknown };
export type TemplateDocument = { width: number; height: number; objects: TemplateElement[]; [key: string]: unknown };
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
