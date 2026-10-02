/**
 * Mesure des leviers Core Web Vitals (WP8c).
 *
 * Lighthouse / PageSpeed Insights ne sont pas exécutables ici (pas de navigateur,
 * localhost non joignable depuis PSI). Ce harnais mesure donc les leviers
 * contrôlables et produit un rapport avant/après chiffré.
 *
 * Usage :
 *   node scripts/measure-perf.cjs                       # rapport à l'écran
 *   node scripts/measure-perf.cjs --save rapport.json   # enregistre l'état
 *   node scripts/measure-perf.cjs --compare rapport.json # compare avec un état
 *   PORT=3003 node scripts/measure-perf.cjs             # mesurer un autre port
 *
 * À mesurer en production (`npm run build && npm run start -- -p 3003`) : en
 * mode dev, le JavaScript n'est pas minifié et les en-têtes de cache diffèrent.
 */
const http = require("node:http");
const path = require("node:path");
const zlib = require("node:zlib");
const { readFileSync, readdirSync, writeFileSync, existsSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);

function fetch(urlPath, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method: "GET", headers: extraHeaders ?? {} },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} Ko`;

/** Attribut d'une balise (insensible à la casse, `srcset` comme `srcSet`). */
function attribute(element, name) {
  const match = element.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? match[1].replace(/&amp;/g, "&") : null;
}

/** Largeur nécessaire à une fenêtre de référence, d'après l'attribut `sizes`. */
function neededWidth(sizes, viewport) {
  if (!sizes) return viewport; // sans `sizes`, le navigateur suppose 100vw
  const entries = sizes.split(",").map((entry) => entry.trim());
  const fallback = entries[entries.length - 1]; // dernière entrée = valeur par défaut
  const pixels = fallback.match(/^(\d+(?:\.\d+)?)px$/);
  if (pixels) return Number(pixels[1]);
  const viewportUnits = fallback.match(/^(\d+(?:\.\d+)?)vw$/);
  if (viewportUnits) return (Number(viewportUnits[1]) / 100) * viewport;
  return viewport;
}

/**
 * Variante réellement téléchargée par un navigateur : le plus petit candidat du
 * `srcset` couvrant la largeur nécessaire (fenêtre de référence 1280 px, DPR 1).
 */
function pickVariant(src, srcset, sizes, viewport = 1280) {
  if (!srcset) return src;
  const candidates = srcset
    .split(",")
    .map((entry) => {
      const [url, descriptor] = entry.trim().split(/\s+/);
      return { url, width: descriptor ? Number(descriptor.replace("w", "")) : 0 };
    })
    .filter((candidate) => candidate.url && candidate.width > 0)
    .sort((a, b) => a.width - b.width);

  if (candidates.length === 0) return src;
  const needed = neededWidth(sizes, viewport);
  return (candidates.find((candidate) => candidate.width >= needed) ?? candidates[candidates.length - 1]).url;
}
const gzipSize = (buffer) => zlib.gzipSync(buffer).length;
const signed = (before, after) => {
  const delta = after - before;
  const percent = before === 0 ? 0 : (delta / before) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} (${sign}${percent.toFixed(1)} %)`;
};

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

async function collect() {
  const dbUrl = readFileSync(path.resolve(".env"), "utf8").match(
    /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
  )[1];
  const db = new Database();
  const article = db
    .prepare("SELECT slug FROM Article WHERE status = 'PUBLISHED' ORDER BY publishedAt DESC LIMIT 1")
    .get();
  const articleWithCover = db
    .prepare("SELECT slug FROM Article WHERE status = 'PUBLISHED' AND coverImageUrl IS NOT NULL LIMIT 1")
    .get();
  const competition = db.prepare("SELECT slug FROM Competition ORDER BY name LIMIT 1").get();
  const match = db.prepare("SELECT id FROM Match ORDER BY scheduledAt DESC LIMIT 1").get();
  db.close();

  const pages = [
    ["accueil", "/"],
    ["scores", "/scores"],
    ["article", article ? `/article/${article.slug}` : null],
    ["article-avec-cover", articleWithCover ? `/article/${articleWithCover.slug}` : null],
    ["compétition", competition ? `/competition/${competition.slug}` : null],
    ["match", match ? `/match/${match.id}` : null],
    ["abonnement", "/abonnement"],
  ].filter(([, urlPath]) => Boolean(urlPath));

  const report = { port: PORT, pages: {}, cache: {}, images: {}, fonts: {}, client: {} };

  for (const [label, urlPath] of pages) {
    const page = await fetch(urlPath);
    const html = page.bytes;

    const scripts = [...new Set(
      [...html.toString("utf8").matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]),
    )];
    const styles = [...new Set(
      [...html.toString("utf8").matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]),
    )];

    let js = 0;
    let css = 0;
    for (const src of scripts) js += gzipSize((await fetch(src)).bytes);
    for (const href of styles) css += gzipSize((await fetch(href)).bytes);

    report.pages[label] = {
      html: html.length,
      htmlGz: gzipSize(html),
      jsGz: js,
      cssGz: css,
      chunks: scripts.length,
      cacheControl: page.headers["cache-control"] ?? "—",
    };

    // Inventaire des balises <img> de la page, et poids réellement téléchargé
    // (variante choisie par le navigateur pour une fenêtre de 1280 px).
    const images = { total: 0, dimensions: 0, sizes: 0, priority: 0, lazy: 0, withoutAlt: 0, bytes: 0, variants: [] };
    for (const tag of html.toString("utf8").matchAll(/<img\b[^>]*>/g)) {
      const element = tag[0];
      images.total += 1;
      const hasWidth = /\bwidth="/.test(element);
      const hasHeight = /\bheight="/.test(element);
      const isFill = /position:absolute/.test(element);
      if ((hasWidth && hasHeight) || isFill) images.dimensions += 1;
      if (/\bsizes="/.test(element)) images.sizes += 1;
      if (/fetchpriority="high"/i.test(element)) images.priority += 1;
      if (/loading="lazy"/.test(element)) images.lazy += 1;
      if (!/\balt=/.test(element)) images.withoutAlt += 1;

      const url = pickVariant(
        attribute(element, "src"),
        attribute(element, "srcset"),
        attribute(element, "sizes"),
      );
      if (url) {
        const asset = await fetch(url.replace(/^https?:\/\/[^/]+/, ""), {
          accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        });
        images.bytes += asset.bytes.length;
        const width = (url.match(/[?&]w=(\d+)/) ?? [])[1];
        if (width && images.variants.length < 4) images.variants.push(Number(width));
      }
    }
    // Next 15 annonce l'image LCP par <link rel="preload" as="image"> plutôt que
    // par l'attribut `fetchpriority` : on compte les deux.
    images.preloads = (html.toString("utf8").match(/rel="preload"[^>]+as="image"/g) ?? []).length;
    report.pages[label].imagePreloads = images.preloads;
    report.images[label] = images;
  }

  // En-têtes de cache des ressources clés.
  const home = await fetch("/");
  const homeHtml = home.bytes.toString("utf8");
  const chunk = [...homeHtml.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])[0];
  const style = [...homeHtml.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1])[0];
  report.cache.html = home.headers["cache-control"] ?? "—";
  if (chunk) report.cache.chunkJs = (await fetch(chunk)).headers["cache-control"] ?? "—";
  if (style) report.cache.css = (await fetch(style)).headers["cache-control"] ?? "—";
  const optimized = await fetch("/_next/image?url=%2Fog-default.png&w=640&q=75");
  report.cache.optimizedImage = optimized.headers["cache-control"] ?? "—";
  report.cache.optimizedImageType = optimized.headers["content-type"] ?? "—";
  // Négociation de format : un navigateur moderne annonce AVIF puis WebP.
  const negotiated = await fetch("/_next/image?url=%2Fog-default.png&w=640&q=75", {
    accept: "image/avif,image/webp,image/*,*/*;q=0.8",
  });
  report.cache.optimizedImageNegotiated = negotiated.headers["content-type"] ?? "—";
  const api = await fetch("/api/auth/session");
  report.cache.api = api.headers["cache-control"] ?? "—";

  // Polices.
  const styles = [...new Set(
    [...homeHtml.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]),
  )];
  let fontFaces = 0;
  let fontDisplay = 0;
  let fontFiles = 0;
  for (const href of styles) {
    const css = (await fetch(href)).bytes.toString("utf8");
    fontFaces += (css.match(/@font-face/g) ?? []).length;
    fontDisplay += (css.match(/font-display\s*:\s*swap/g) ?? []).length;
    fontFiles += new Set([...css.matchAll(/url\(([^)]+\.(?:woff2?|ttf|otf))\)/g)].map((m) => m[1])).size;
  }
  report.fonts = {
    fontFaces,
    fontDisplay,
    fontFiles,
    preloadedFonts: (homeHtml.match(/rel="preload"[^>]+as="font"/g) ?? []).length,
    nextFont: /next\/font/.test(readFileSync("src/app/layout.tsx", "utf8")),
  };

  // JavaScript client.
  const sources = walk("src").filter((file) => /\.(tsx|jsx|ts|js)$/.test(file));
  const clientFiles = sources.filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8")));
  report.client = {
    sources: sources.length,
    clientFiles: clientFiles.length,
    names: clientFiles.map((file) => path.basename(file)).sort(),
  };

  return report;
}

function pageTotal(report, label) {
  const page = report.pages[label];
  if (!page) return 0;
  return page.htmlGz + page.jsGz + page.cssGz + (report.images[label]?.bytes ?? 0);
}

function printReport(report) {
  console.log("=== Poids des pages (production, 1re visite) ===");
  console.log("page                 HTML.gz   JS (gz)   CSS (gz)  images    total (gz+images)  chunks");
  for (const [label, page] of Object.entries(report.pages)) {
    const images = report.images[label]?.bytes ?? 0;
    console.log(
      `${label.padEnd(20)} ${kb(page.htmlGz).padEnd(9)} ${kb(page.jsGz).padEnd(9)} ` +
        `${kb(page.cssGz).padEnd(9)} ${kb(images).padEnd(9)} ${kb(pageTotal(report, label)).padEnd(19)} ${page.chunks}`,
    );
  }

  console.log("\n=== Cache ===");
  for (const [key, value] of Object.entries(report.cache)) {
    console.log(`${key.padEnd(20)} ${String(value).slice(0, 70)}`);
  }

  console.log("\n=== Images ===");
  console.log("page                 total  dim.  sizes  prio  preload  lazy  sans alt  poids");
  for (const [label, images] of Object.entries(report.images)) {
    console.log(
      `${label.padEnd(20)} ${String(images.total).padEnd(6)} ${String(images.dimensions).padEnd(5)} ` +
        `${String(images.sizes).padEnd(6)} ${String(images.priority).padEnd(5)} ${String(images.preloads ?? 0).padEnd(8)} ` +
        `${String(images.lazy).padEnd(5)} ${String(images.withoutAlt).padEnd(9)} ${kb(images.bytes)}` +
        (images.variants?.length ? ` (variantes w=${images.variants.join(", ")})` : ""),
    );
  }

  console.log("\n=== Polices ===");
  console.log(`@font-face : ${report.fonts.fontFaces} | font-display: swap : ${report.fonts.fontDisplay} | fichiers : ${report.fonts.fontFiles}`);
  console.log(`préchargements de police : ${report.fonts.preloadedFonts} | next/font : ${report.fonts.nextFont}`);

  console.log("\n=== JavaScript client ===");
  console.log(`fichiers source : ${report.client.sources} | « use client » : ${report.client.clientFiles}`);
  console.log(`composants : ${report.client.names.join(", ")}`);
}

function compare(before, after) {
  console.log("=== Comparaison avant / après ===");
  console.log("page                 HTML.gz (Δ)                 images (Δ)                poids total (Δ)");
  for (const label of Object.keys(after.pages)) {
    const previous = before.pages[label];
    if (!previous) continue;
    const previousImages = before.images?.[label]?.bytes;
    const afterImages = after.images[label]?.bytes ?? 0;
    const imagesLine =
      previousImages === undefined
        ? "images : n/d (mesure antérieure sans ce champ)".padEnd(26)
        : `${kb(previousImages)} → ${kb(afterImages)} (${signed(previousImages, afterImages)})`.padEnd(26);
    const totalLine =
      previousImages === undefined
        ? "poids total : n/d avant (images non mesurées)"
        : `${kb(pageTotal(before, label))} → ${kb(pageTotal(after, label))} (${signed(pageTotal(before, label), pageTotal(after, label))})`;
    console.log(
      `${label.padEnd(20)} ${`${kb(previous.htmlGz)} → ${kb(after.pages[label].htmlGz)} (${signed(previous.htmlGz, after.pages[label].htmlGz)})`.padEnd(30)} ` +
        `${imagesLine} ${totalLine}`,
    );
  }

  console.log("\n=== Cache avant / après ===");
  for (const key of Object.keys(after.cache)) {
    console.log(`${key.padEnd(20)} ${String(before.cache[key] ?? "—").slice(0, 45).padEnd(47)} → ${String(after.cache[key]).slice(0, 60)}`);
  }

  console.log("\n=== Images : priorité (preload), dimensions et variantes ===");
  console.log("page                 preload (avant → après)     dimensions (avant → après)");
  for (const label of Object.keys(after.images)) {
    const previous = before.images[label];
    if (!previous) continue;
    const previousPreloads = before.pages[label]?.imagePreloads ?? 0;
    console.log(
      `${label.padEnd(20)} ${`${previousPreloads}`.padEnd(26)} → ${`${after.pages[label]?.imagePreloads ?? 0}`.padEnd(26)} ` +
        `${`${previous.dimensions}/${previous.total}`} → ${after.images[label].dimensions}/${after.images[label].total}` +
        (after.images[label].variants?.length ? `   variantes w=${after.images[label].variants.join(", ")}` : ""),
    );
  }

  console.log(`\npolices : @font-face ${before.fonts.fontFaces} → ${after.fonts.fontFaces} | composants clients ${before.client.clientFiles} → ${after.client.clientFiles}`);
}

async function main() {
  const saveIndex = process.argv.indexOf("--save");
  const compareIndex = process.argv.indexOf("--compare");

  const report = await collect();
  printReport(report);

  if (saveIndex > -1 && process.argv[saveIndex + 1]) {
    const target = path.resolve(process.argv[saveIndex + 1]);
    writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(`\nrapport enregistré : ${target}`);
  }

  if (compareIndex > -1 && process.argv[compareIndex + 1]) {
    const target = path.resolve(process.argv[compareIndex + 1]);
    if (!existsSync(target)) {
      console.error(`\nrapport de référence introuvable : ${target}`);
      process.exitCode = 1;
      return;
    }
    compare(JSON.parse(readFileSync(target, "utf8")), report);
  }
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
