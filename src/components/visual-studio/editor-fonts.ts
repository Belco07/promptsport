/** Real font files are loaded before Fabric measures text, including exports. */
export const EDITOR_FONTS = ["Inter", "Sora", "Oswald", "Barlow Condensed"] as const;
export function fontWeights(family: string) {
  const min = family === "Oswald" ? 200 : 100;
  const max = family === "Oswald" ? 700 : family === "Sora" ? 800 : 900;
  return Array.from({ length: (max - min) / 100 + 1 }, (_, index) => min + index * 100);
}
let loading: Promise<void> | undefined;
export function loadEditorFonts() {
  return loading ??= (async () => {
    const sources = [
      ["Inter", "Inter-roman.var.woff2", "100 900"],
      ["Sora", "Sora.ttf", "100 800"],
      ["Oswald", "Oswald.ttf", "200 700"],
      // Keep existing saved templates readable.
      ["Montserrat", "Montserrat.ttf", "100 900"],
      ...["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black"].map((name, index) => ["Barlow Condensed", `BarlowCondensed-${name}.ttf`, String((index + 1) * 100)]),
    ];
    await Promise.all(sources.map(async ([family, file, weight]) => {
      const face = await new FontFace(family, `url(/fonts/${file})`, { weight }).load();
      document.fonts.add(face);
    }));
    document.fonts.add(await new FontFace("Inter", "url(/fonts/Inter-italic.var.woff2)", { weight: "100 900", style: "italic" }).load());
  })().catch(error => { loading = undefined; throw error; });
}
