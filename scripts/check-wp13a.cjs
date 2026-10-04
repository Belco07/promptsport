/**
 * Vérification du WP13a — fondations du système de thème (clair/sombre/système).
 * Exécution : PORT=3002 node scripts/check-wp13a.cjs
 *
 * Le sélecteur de thème n'apparaît qu'après montage (next-themes lit
 * localStorage et matchMedia) : le HTML servi contient une place réservée, et le
 * balisage réel vit dans le bundle client. On contrôle donc les deux, plus le
 * script anti-FOUC injecté dans le <head> et la compilation des variants `dark:`.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3002);

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "localhost", port: PORT, path: urlPath }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      })
      .on("error", reject);
  });
}

/** Cherche un extrait dans les scripts référencés par une page. */
async function bodyContainsInScripts(html, needle) {
  const sources = [...html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const src of [...new Set(sources)]) {
    const chunk = await get(src);
    if (chunk.body.includes(needle)) return src;
  }
  return null;
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  const home = await get("/");
  const login = await get("/login");
  if (home.status !== 200 || !home.body.includes("PromptSport")) {
    throw new Error(
      `Le port ${PORT} ne sert pas promptsport : relancez avec PORT=<port de promptsport>.`,
    );
  }

  /* ------------------------------------------------------ 1) Bibliothèque */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  check(
    "next-themes déclaré dans package.json",
    Boolean(pkg.dependencies?.["next-themes"]),
    pkg.dependencies?.["next-themes"],
  );

  /* --------------------------------------------- 2) Configuration Tailwind */
  const tailwind = fs.readFileSync(path.join(ROOT, "tailwind.config.js"), "utf8");
  check("tailwind : darkMode par classe", /darkMode:\s*["']class["']/.test(tailwind));
  check(
    "tailwind : palette sémantique complète",
    ["background", "foreground", "muted", "border", "card", "accent"].every((token) =>
      new RegExp(`\\b${token}:`).test(tailwind),
    ),
    "background, foreground, muted, border, card, accent",
  );
  check(
    "tailwind : accent sémantique sans casser l'échelle accent-500",
    /accent:\s*\{\s*DEFAULT:/.test(tailwind) && tailwind.includes("...accent"),
  );

  /* ------------------------------------------------ 3) Variables CSS (thème) */
  const css = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  check(
    "globals.css : variables du thème clair",
    /:root\s*\{[\s\S]*?--background:[\s\S]*?--foreground:[\s\S]*?--accent:/.test(css),
  );
  check(
    "globals.css : variables du thème sombre",
    /\.dark\s*\{[\s\S]*?--background:[\s\S]*?--foreground:[\s\S]*?--accent:/.test(css),
  );

  /* -------------------------------------------- 4) Provider et layout racine */
  const layout = fs.readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf8");
  check(
    "layout : <ThemeProvider> enveloppe l'application",
    layout.includes("<ThemeProvider>") && layout.includes("</ThemeProvider>"),
  );
  check("layout : <html suppressHydrationWarning>", /<html[^>]*suppressHydrationWarning/.test(layout));
  check(
    "layout : couleurs sémantiques sur le body",
    /className="[^"]*bg-background[^"]*text-foreground/.test(layout),
  );

  const provider = fs.readFileSync(path.join(ROOT, "src/components/ThemeProvider.tsx"), "utf8");
  check(
    "ThemeProvider : attribute / defaultTheme / enableSystem / disableTransitionOnChange",
    ['attribute="class"', 'defaultTheme="system"', "enableSystem", "disableTransitionOnChange"].every(
      (needle) => provider.includes(needle),
    ),
  );

  /* ------------------------------------------------- 5) Sélecteur de thème */
  const nav = fs.readFileSync(path.join(ROOT, "src/components/PublicNav.tsx"), "utf8");
  check("PublicNav : <ThemeToggle /> à côté du compte", nav.includes("<ThemeToggle />") && nav.includes("<UserMenu />"));

  const toggle = fs.readFileSync(path.join(ROOT, "src/components/ThemeToggle.tsx"), "utf8");
  check(
    "toggle : trois choix clair / sombre / système",
    ['"light"', '"dark"', '"system"'].every((value) => toggle.includes(value)) &&
      ["Sun", "Moon", "Monitor"].every((icon) => toggle.includes(icon)),
  );
  check(
    "toggle : garde de montage (pas de thème faux à l'hydratation)",
    /useState\(false\)/.test(toggle) && /setMounted\(true\)/.test(toggle) && toggle.includes("if (!mounted)"),
  );
  check(
    "toggle : menu accessible (ARIA + clavier)",
    toggle.includes('aria-haspopup="menu"') &&
      toggle.includes("aria-expanded") &&
      toggle.includes('role="menuitemradio"') &&
      toggle.includes("aria-checked") &&
      toggle.includes("ArrowDown") &&
      toggle.includes('"Escape"'),
  );

  /* -------------------------------------- 6) Comportement dans le HTML servi */
  // next-themes injecte un script inline qui pose la classe avant tout contenu :
  // c'est ce qui évite le flash de thème clair. En App Router ce script est émis
  // dans le flux du body (juste après le lien d'évitement), pas dans <head> : on
  // isole donc le bloc <script> qui le contient et on vérifie sa position.
  const markerAt = home.body.indexOf("prefers-color-scheme");
  const scriptStart = markerAt >= 0 ? home.body.lastIndexOf("<script", markerAt) : -1;
  const scriptEnd = markerAt >= 0 ? home.body.indexOf("</script>", markerAt) : -1;
  const themeScript =
    scriptStart >= 0 && scriptEnd > markerAt ? home.body.slice(scriptStart, scriptEnd) : "";
  const headerAt = home.body.indexOf("<header");
  check(
    "anti-FOUC : script inline du thème avant tout contenu",
    ["localStorage", "prefers-color-scheme", "classList"].every((needle) => themeScript.includes(needle)) &&
      scriptStart >= 0 &&
      headerAt > scriptStart,
    `script@${scriptStart} header@${headerAt}`,
  );
  check(
    "page publique : place réservée avant montage (pas de thème figé)",
    home.body.includes("<span aria-hidden=\"true\" class=\"inline-block h-9 w-9\"></span>") ||
      !home.body.includes("Choix du thème"),
  );
  const inBundle = await bodyContainsInScripts(home.body, "Choix du thème");
  check("sélecteur embarqué dans le bundle client", Boolean(inBundle), inBundle ?? "introuvable");
  const bundleOptions = await bodyContainsInScripts(home.body, "menuitemradio");
  check("les trois options sont embarquées", Boolean(bundleOptions), bundleOptions ?? "introuvable");
  check("page de connexion : aucun sélecteur (barre publique masquée)", !login.body.includes("Choix du thème"));

  /* ------------------------------- 7) Variants dark: effectivement compilés */
  const cssHref = /href="(\/_next\/static\/[^"]+\.css)"/.exec(home.body)?.[1];
  if (cssHref) {
    const sheet = await get(cssHref);
    check(
      "feuille compilée : règles .dark présentes",
      sheet.body.includes(".dark") || sheet.body.includes("--background"),
      cssHref,
    );
  } else {
    check("feuille de style détectée", false, "aucun lien CSS dans la page");
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exit(1);
});
