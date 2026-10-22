import { FabricImage, type StaticCanvas } from "fabric";
type BackgroundImage = FabricImage & { assetRole?: string };
export function backgroundLayer(canvas: StaticCanvas) {
  return canvas.getObjects().find(object => (object as BackgroundImage).assetRole === "background") as FabricImage | undefined;
}
/** The photo is the only movable object in a journalist's locked template. */
export function installBackground(canvas: StaticCanvas, image: FabricImage) {
  const previous = backgroundLayer(canvas);
  if (previous) canvas.remove(previous);
  canvas.backgroundImage = undefined;
  (image as BackgroundImage).assetRole = "background";
  image.set({ selectable: true, evented: true, lockMovementX: false, lockMovementY: false, lockScalingX: false, lockScalingY: false, lockRotation: false });
  canvas.insertAt(0, image);
  image.setCoords();
  canvas.requestRenderAll();
}
