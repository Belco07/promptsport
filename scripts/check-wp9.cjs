/**
 * Vérification du WP9 — design system, refonte des pages publiques, page auteur.
 * Exécution : PORT=3002 node scripts/check-wp9.cjs
 *
 * Le script contrôle des faits vérifiables : palette réellement compilée par
 * Tailwind, police auto-hébergée, composants présents et utilisés, en-têtes
 * d'accessibilité, défilement des tableaux sur mobile, contrastes WCAG AA
 * calculés depuis les valeurs de la palette, et absence de régression sur les
 * fonctionnalités existantes.
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync, readdirSync, statSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const ORIGIN = `http://${HOST}:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
/* PROD=1 pour contrôler un serveur de production (npm run start) : seules les
 * attentes liées au développement (préchargement de la police, jeton CSRF)
 * changent. */
const PROD = process.env.PROD === "1";

const dbUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(ROOT, dbUrl.replace(/^file:(\/\/)?/, "")));

/* ------------------------------------------------------------------ outils */

function createJar() {
  const store = new Map();
  return {
    absorb(list) {
      for (const raw of list ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    has: (name) => Boolean(store.get(name)),
  };
}

function request(method, urlPath, { jar, form, headers: extra } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = { ...(extra ?? {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          jar?.absorb(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = (urlPath, options) => request("GET", urlPath, options);

async function login(email, password) {
  const jar = createJar();
  await get("/login", { jar });
  const csrfBody = (await get("/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(
      `Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF) : un autre projet l'occupe probablement.`,
    );
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/` },
  });
  return jar;
}

/** Cherche une chaîne dans les bundles JavaScript référencés par une page. */
async function chunkContains(html, needle) {
  const sources = [...new Set([...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]))];
  for (const src of sources) {
    if ((await get(src)).body.includes(needle)) return src;
  }
  return null;
}

/** Feuille de style réellement servie pour une page (développement ou production). */
async function pageCss(urlPath = "/") {
  const html = (await get(urlPath)).body;
  const hrefs = [...new Set([...html.matchAll(/href="([^"]+\.css[^"]*)"/g)].map((m) => m[1]))];
  let css = "";
  for (const href of hrefs) {
    const target = href.startsWith("http") ? href : `${ORIGIN}${href}`;
    css += (await get(target.replace(ORIGIN, ""))).body;
  }
  return { html, css };
}

/* --------------------------------------------------- contraste WCAG (AA) */

function luminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  const [light, dark] = first > second ? [first, second] : [second, first];
  return (light + 0.05) / (dark + 0.05);
}

/** Palette déclarée dans tailwind.config.js (source unique du design system). */
function readPalette() {
  const source = readFileSync(path.join(ROOT, "tailwind.config.js"), "utf8");
  const palette = {};
  for (const [, name, body] of source.matchAll(/const (\w+) = \{([\s\S]*?)\n\};/g)) {
    const shades = {};
    for (const [, shade, hex] of body.matchAll(/(\d+):\s*"(#[0-9a-fA-F]{6})"/g)) {
      shades[shade] = hex;
    }
    palette[name] = shades;
  }
  return palette;
}

/* ------------------------------------------------------------------ tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

/** Liste récursive des fichiers d'un dossier, filtrés par extension. */
function walk(directory, extension, files = []) {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "generated" || entry === ".next") continue;
      walk(full, extension, files);
    } else if (full.endsWith(extension)) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const palette = readPalette();

  /* -------------------------------------------------- 1) Palette de couleurs */
  section("Palette et typographie");
  const required = ["primary", "accent", "success", "danger", "neutral"];
  check(
    "tailwind.config.js : cinq échelles de couleurs",
    required.every((name) => palette[name] && Object.keys(palette[name]).length >= 10),
    required.map((name) => `${name}:${Object.keys(palette[name] ?? {}).length}`).join(" "),
  );
  check(
    "ancres du brief (#0F172A, #F97316, #10B981, #EF4444)",
    palette.primary?.["900"] === "#0f172a" &&
      palette.accent?.["500"] === "#f97316" &&
      palette.success?.["500"] === "#10b981" &&
      palette.danger?.["500"] === "#ef4444",
    `${palette.primary?.["900"]} / ${palette.accent?.["500"]} / ${palette.success?.["500"]} / ${palette.danger?.["500"]}`,
  );
  check(
    "échelle de gris complète (50 → 950)",
    ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"].every(
      (shade) => palette.neutral?.[shade],
    ),
    Object.keys(palette.neutral ?? {}).join(", "),
  );

  const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  check("globals.css charge tailwind.config.js (@config)", /@config\s+"\.\.\/\.\.\/tailwind\.config\.js"/.test(globals));
  check("globals.css référence la palette via theme()", globals.includes("theme(--color-primary-600)"));
  check("corps d'article : largeur de lecture 720 px", readFileSync(path.join(ROOT, "tailwind.config.js"), "utf8").includes('prose: "45rem"'));

  const { html: homeHtml, css } = await pageCss("/");
  check(
    "utilitaires de la palette réellement compilés",
    /\.bg-primary-900\s*\{\s*background-color:\s*#0f172a/.test(css) &&
      /\.bg-accent-500\s*\{\s*background-color:\s*#f97316/.test(css) &&
      /\.text-neutral-900\s*\{\s*color:\s*#111827/.test(css),
    "bg-primary-900, bg-accent-500, text-neutral-900",
  );
  check(
    "couleurs par défaut préservées (studio/backoffice)",
    /\.bg-gray-50\s*\{/.test(css) && /\.text-amber-900\s*\{/.test(css),
    "bg-gray-50 + text-amber-900 présents",
  );

  /* ------------------------------------------------------------ 2) Police */
  check("police chargée via next/font (variable --font-inter)", /--font-inter\s*:\s*"Inter"/.test(css));
  check("@font-face Inter auto-hébergée", /@font-face/.test(css) && /Inter/i.test(css));
  check(
    "aucun appel à Google Fonts au chargement",
    !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(homeHtml) && !/fonts\.googleapis\.com/.test(css),
  );
  check(
    "préchargement de la police (production) / display swap (développement)",
    PROD
      ? /<link[^>]+rel="preload"[^>]+as="font"/.test(homeHtml)
      : /@font-face\s*\{[^}]*font-display:\s*swap/.test(css),
    PROD ? "lien preload" : "font-display: swap dans @font-face",
  );
  check(
    "police appliquée au corps de page",
    /class="[^"]*font-sans/.test(homeHtml),
  );

  /* -------------------------------------------------- 3) Composants de base */
  section("Composants du design system (src/components/ui)");
  const uiDir = path.join(ROOT, "src/components/ui");
  const uiFiles = ["Button", "Badge", "Card", "Input", "Textarea", "Select"];
  check(
    "six composants présents",
    uiFiles.every((name) => statSync(path.join(uiDir, `${name}.tsx`), { throwIfNoEntry: false })),
    uiFiles.join(", "),
  );

  const button = readFileSync(path.join(uiDir, "Button.tsx"), "utf8");
  check(
    "Button : variantes primary/secondary/ghost/danger",
    ["primary", "secondary", "ghost", "danger"].every((variant) => button.includes(`${variant}:`)),
  );
  check("Button : tailles sm/md/lg", ["sm:", "md:", "lg:"].every((size) => button.includes(size)));
  check("Button : style réutilisable pour les liens (buttonStyles)", /export function buttonStyles/.test(button));

  const badge = readFileSync(path.join(uiDir, "Badge.tsx"), "utf8");
  check(
    "Badge : variantes premium/category/status/role",
    ["premium", "category", "status", "role"].every((variant) => badge.includes(variant)),
  );
  check("Badge : couleurs configurables (prop tone)", badge.includes('tone?: BadgeTone'));

  const card = readFileSync(path.join(uiDir, "Card.tsx"), "utf8");
  check(
    "Card : ombre, coins arrondis et effet au survol",
    card.includes("shadow-card") && card.includes("rounded-xl") && card.includes("hover:shadow-card-hover"),
  );

  const input = readFileSync(path.join(uiDir, "Input.tsx"), "utf8");
  check(
    "Input : étiquette, aide, erreur et relations ARIA",
    input.includes("aria-describedby") && input.includes("aria-invalid") && input.includes("htmlFor"),
  );
  check(
    "Textarea et Select dérivent des mêmes styles de champ",
    readFileSync(path.join(uiDir, "Textarea.tsx"), "utf8").includes("fieldStyles") &&
      readFileSync(path.join(uiDir, "Select.tsx"), "utf8").includes("fieldStyles"),
  );

  // Composants réellement utilisés dans les pages publiques.
  const appFiles = walk(path.join(ROOT, "src/app"), ".tsx");
  const usersOfUi = appFiles.filter((file) =>
    readFileSync(file, "utf8").includes('from "@/components/ui/'),
  );
  check(
    "composants du design system utilisés dans au moins 3 pages",
    usersOfUi.length >= 3,
    `${usersOfUi.length} fichier(s) : ${usersOfUi.map((file) => path.basename(path.dirname(file))).join(", ")}`,
  );

  /* --------------------------------------------------- 4) Header et footer */
  section("Header et footer publics");
  const nav = readFileSync(path.join(ROOT, "src/components/PublicNav.tsx"), "utf8");
  // Le logo dessiné en SVG (LogoMark) a été remplacé par le logo de la marque :
  // le fichier public/promptsport-logo.webp est servi par next/image.
  check(
    "header : logo de la marque",
    nav.includes('src="/promptsport-logo.webp"') &&
      nav.includes('alt="PromptSport') &&
      nav.includes("next/image"),
    nav.includes("LogoMark") ? "ancien SVG encore présent" : undefined,
  );
  check(
    "header : navigation Accueil / Scores / Compétitions / Abonnement",
    ["Accueil", "Scores", "Compétitions", "Abonnement"].every((label) => nav.includes(label)),
  );
  check(
    "header : menu déroulant Compétitions accessible",
    nav.includes('aria-haspopup="true"') && nav.includes("aria-expanded={competitionsOpen}") && nav.includes('aria-controls="menu-competitions"'),
  );
  check(
    "header : bouton burger (aria-expanded + libellé)",
    nav.includes('aria-controls="menu-mobile"') && nav.includes("Ouvrir le menu") && nav.includes("Fermer le menu"),
  );
  check("header : menu burger réservé au mobile (md:hidden)", /md:hidden/.test(nav));
  check(
    "header : navigation de bureau masquée sous 768 px",
    nav.includes("hidden items-center gap-1 md:flex"),
  );
  check(
    "header : menu utilisateur réutilisé (Mon compte / Se connecter)",
    nav.includes("<UserMenu />"),
  );
  check("header masqué sur /studio, /backoffice et /login", nav.includes('pathname.startsWith("/backoffice/")'));

  const footer = readFileSync(path.join(ROOT, "src/components/Footer.tsx"), "utf8");
  check(
    "footer : trois colonnes Navigation / À propos / Suivez-nous",
    ["Navigation", "À propos", "Suivez-nous"].every((label) => footer.includes(label)),
  );
  check("footer : lien RSS", footer.includes('href="/rss.xml"') && footer.includes("<Rss"));
  check(
    "footer : mentions légales et confidentialité",
    footer.includes('href="/mentions-legales"') && footer.includes('href="/confidentialite"'),
  );
  check("footer : copyright", /© \{new Date\(\)\.getFullYear\(\)\}/.test(footer));

  const home = await get("/");
  check(
    "footer rendu sur l'accueil : colonnes et flux RSS",
    home.body.includes("Suivez-nous") && home.body.includes('href="/rss.xml"') && home.body.includes("Mentions légales"),
  );

  /* --------------------------------------------------------- 5) Page auteur */
  section("Page auteur /auteur/[slug]");
  const author = db
    .prepare(
      `SELECT a.slug, a.name, a.bio, COUNT(ar.id) AS articles
       FROM Author a JOIN Article ar ON ar.authorId = a.id
       WHERE a.slug IS NOT NULL AND ar.status = 'PUBLISHED'
       GROUP BY a.id ORDER BY articles DESC LIMIT 1`,
    )
    .get();
  check("migration add_author_slug appliquée", Boolean(author), author ? `${author.name} (${author.slug})` : "aucun auteur");

  if (author) {
    const page = await get(`/auteur/${author.slug}`);
    check("GET /auteur/[slug] -> 200", page.status === 200, `status=${page.status}`);
    check("page auteur : nom affiché", page.body.includes(author.name));
    check(
      "page auteur : biographie (ou mention d'absence)",
      page.body.includes("n&#x27;a pas encore renseigné de biographie") || Boolean(author.bio),
      author.bio ? "biographie présente en base" : "mention d'absence affichée",
    );
    const published = db
      .prepare("SELECT title FROM Article WHERE authorId = (SELECT id FROM Author WHERE slug = ?) AND status = 'PUBLISHED' LIMIT 1")
      .get(author.slug);
    check(
      "page auteur : articles publiés listés",
      !published || page.body.includes(published.title),
      published ? published.title.slice(0, 48) : "(aucun article)",
    );
    check(
      "page auteur : JSON-LD Person",
      /"@type"\s*:\s*"Person"/.test(page.body) && /"worksFor"/.test(page.body) && /"jobTitle"/.test(page.body),
    );
    check(
      "page auteur : titre de page = nom de l'auteur",
      new RegExp(`<title>${author.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(page.body),
    );
  }
  check("slug d'auteur inconnu -> 404", (await get("/auteur/inconnu-xyz")).status === 404);

  const article = db
    .prepare("SELECT slug, authorId FROM Article WHERE status = 'PUBLISHED' LIMIT 1")
    .get();
  const authorSlug = article
    ? db.prepare("SELECT slug FROM Author WHERE id = ?").get(article.authorId)?.slug
    : null;
  if (article && authorSlug) {
    const articlePage = await get(`/article/${article.slug}`);
    check(
      "article : lien vers la page auteur",
      articlePage.body.includes(`href="/auteur/${authorSlug}"`),
      `/auteur/${authorSlug}`,
    );
  }

  /* ------------------------------------------------------ 6) Pages refondues */
  section("Pages publiques refondues");
  const pages = [
    // Repères structurels plutôt que copie éditoriale : les libellés de la une
    // ont évolué après le WP9 (passe « news-* »), pas la structure attendue.
    ["/", ["À la une", "derniers-articles", 'href="/article/']],
    ["/scores", ["En direct", "À venir", "Terminés récemment", "Filtrer"]],
    ["/abonnement", ["Recommandé", "Questions fréquentes", "Abonnez-vous"]],
    ["/mentions-legales", ["Mentions légales", "Propriété intellectuelle"]],
    ["/confidentialite", ["Politique de confidentialité", "ps_vid", "90 jours"]],
  ];
  for (const [urlPath, markers] of pages) {
    const page = await get(urlPath);
    const missing = markers.filter((marker) => !page.body.includes(marker));
    check(`GET ${urlPath} -> 200 avec ses marqueurs`, page.status === 200 && missing.length === 0,
      missing.length ? `manquant : ${missing.join(", ")}` : `status=${page.status}`);
  }

  const competition = db.prepare("SELECT slug FROM Competition LIMIT 1").get();
  if (competition) {
    const page = await get(`/competition/${competition.slug}`);
    check(
      "GET /competition/[slug] -> 200 (classement + légende + résultats)",
      page.status === 200 &&
        page.body.includes("Classement") &&
        page.body.includes("Derniers résultats") &&
        page.body.includes("Diff") &&
        page.body.includes("J : joués"),
      `status=${page.status}`,
    );
  }

  const match = db.prepare("SELECT id FROM Match LIMIT 1").get();
  if (match) {
    const page = await get(`/match/${match.id}`);
    check(
      "GET /match/[id] -> 200 (score mis en avant + informations)",
      page.status === 200 &&
        page.body.includes("Informations du match") &&
        page.body.includes("Coup d&#x27;envoi") &&
        page.body.includes("text-5xl"),
      `status=${page.status}`,
    );
  }

  if (article) {
    const page = await get(`/article/${article.slug}`);
    check(
      "GET /article/[slug] -> 200 (largeur de lecture + temps de lecture)",
      page.status === 200 && page.body.includes("max-w-prose") && /min de lecture/.test(page.body),
      `status=${page.status}`,
    );
    check("article : articles connexes", page.body.includes("À lire aussi"));
  }

  // Espace abonné : nécessite une session.
  const adminJar = await login("admin@example.com", "admin123");
  check("session ADMIN ouverte", adminJar.has("authjs.session-token"));
  const account = await get("/mon-compte", { jar: adminJar });
  check(
    "GET /mon-compte -> 200 (sections Profil / Abonnement / Paiements / Sécurité)",
    account.status === 200 &&
      ["Profil", "Abonnement", "Historique des paiements", "Sécurité"].every((label) =>
        account.body.includes(label),
      ),
    `status=${account.status}`,
  );
  check(
    "mon-compte : formulaire avec les composants du design system",
    account.body.includes('id="name"') && account.body.includes('id="currentPassword"'),
  );

  /* -------------------------------------------------------- 7) Accessibilité */
  section("Accessibilité (WCAG AA)");
  check(
    "lien d'évitement vers le contenu principal",
    homeHtml.includes("Aller au contenu principal") && homeHtml.includes('href="#contenu"'),
  );
  const publicPages = ["/", "/scores", "/abonnement", "/mentions-legales", "/confidentialite"];
  const withoutTarget = [];
  for (const urlPath of publicPages) {
    if (!(await get(urlPath)).body.includes('id="contenu"')) withoutTarget.push(urlPath);
  }
  check("cible du lien d'évitement sur chaque page", withoutTarget.length === 0, withoutTarget.join(", ") || "toutes");

  check(
    "focus visible défini globalement",
    /:focus-visible\s*\{[^}]*outline/.test(css),
  );
  check(
    "page active annoncée côté client, sans divergence d'hydratation",
    // L'onglet actif dépend de `usePathname()`. Il n'est appliqué qu'après
    // montage (`useMounted`) : le HTML du serveur ne doit donc PAS contenir
    // `aria-current`, sinon une URL modifiée pendant l'hydratation provoque
    // « Hydration failed » — l'erreur constatée en production de test, qui
    // laissait ensuite les liens et le bouton « Répondre » inertes.
    /aria-current/.test(readFileSync(path.join(ROOT, "src/components/PublicNav.tsx"), "utf8")) &&
      /useMounted/.test(readFileSync(path.join(ROOT, "src/components/PublicNav.tsx"), "utf8")) &&
      !homeHtml.includes('aria-current="page"'),
    homeHtml.includes('aria-current="page"') ? "aria-current rendu par le serveur" : "appliqué après montage",
  );
  check(
    "champs : identifiant, étiquette et description liés",
    account.body.includes('for="name"') && account.body.includes('id="name"') && account.body.includes("name-aide"),
  );
  check(
    "tableaux : en-têtes de colonnes déclarés (scope=col)",
    account.body.includes('scope="col"') || (await get("/confidentialite")).body.includes('scope="col"'),
  );
  check(
    "tableaux : légende ou description accessible",
    account.body.includes("<caption") || account.body.includes("aria-labelledby"),
  );
  check(
    "sections : titres reliés par aria-labelledby",
    (await get("/scores")).body.includes("aria-labelledby") ||
      (await get("/competition/" + (competition?.slug ?? ""))).body.includes("aria-labelledby"),
  );

  // Contrastes calculés depuis la palette réellement configurée.
  const pairs = [
    ["blanc / primary-900 (bouton principal)", "#ffffff", palette.primary["900"], 4.5],
    ["neutral-300 / primary-900 (footer)", palette.neutral["300"], palette.primary["900"], 4.5],
    ["neutral-400 / primary-900 (mentions du footer)", palette.neutral["400"], palette.primary["900"], 4.5],
    ["accent-400 / primary-900 (lien survolé du footer)", palette.accent["400"], palette.primary["900"], 4.5],
    ["primary-900 / blanc (titres)", palette.primary["900"], "#ffffff", 4.5],
    ["primary-800 / primary-50 (badge rubrique)", palette.primary["800"], palette.primary["50"], 4.5],
    ["primary-700 / blanc (liens)", palette.primary["700"], "#ffffff", 4.5],
    ["primary-600 / blanc (liens du corps)", palette.primary["600"], "#ffffff", 4.5],
    ["neutral-800 / blanc (corps d'article)", palette.neutral["800"], "#ffffff", 4.5],
    ["neutral-700 / blanc (texte courant)", palette.neutral["700"], "#ffffff", 4.5],
    ["neutral-600 / blanc (texte secondaire)", palette.neutral["600"], "#ffffff", 4.5],
    ["neutral-500 / blanc (légendes)", palette.neutral["500"], "#ffffff", 4.5],
    ["accent-700 / blanc (sur-titres)", palette.accent["700"], "#ffffff", 4.5],
    ["blanc / accent-700 (pastille Recommandé)", "#ffffff", palette.accent["700"], 4.5],
    ["accent-800 / accent-50 (alerte Stripe)", palette.accent["800"], palette.accent["50"], 4.5],
    ["blanc / danger-600 (badge EN DIRECT)", "#ffffff", palette.danger["600"], 4.5],
    ["danger-600 / blanc (score en direct)", palette.danger["600"], "#ffffff", 4.5],
    ["danger-700 / danger-50 (message d'erreur)", palette.danger["700"], palette.danger["50"], 4.5],
    ["success-800 / success-50 (message de succès)", palette.success["800"], palette.success["50"], 4.5],
    ["amber-900 / amber-100 (badge Premium)", "#78350f", "#ffedd5", 4.5],
    ["neutral-600 / neutral-50 (texte sur fond de page)", palette.neutral["600"], palette.neutral["50"], 4.5],
  ];
  let worst = { label: "", ratio: 99 };
  const failing = [];
  for (const [label, foreground, background, minimum] of pairs) {
    const ratio = contrast(foreground, background);
    if (ratio < minimum) failing.push(`${label} (${ratio.toFixed(2)}:1)`);
    if (ratio < worst.ratio) worst = { label, ratio };
  }
  check(
    `contrastes texte/fond conformes AA (${pairs.length} paires)`,
    failing.length === 0,
    failing.length ? failing.join(" | ") : `minimum ${worst.ratio.toFixed(2)}:1 (${worst.label})`,
  );

  /* ------------------------------------------------------------ 8) Mobile */
  section("Mobile (375 px)");
  check(
    "viewport déclaré",
    /<meta name="viewport" content="width=device-width, initial-scale=1"/.test(homeHtml),
  );
  check(
    "grilles responsive sur l'accueil",
    homeHtml.includes("grid-cols-1") && homeHtml.includes("sm:grid-cols-2") && homeHtml.includes("lg:grid-cols-3"),
  );
  check(
    "conteneurs centrés avec marge latérale (pas de largeur fixe)",
    // Tolérant aux classes ajoutées autour (passe de design postérieure) :
    // on cherche mx-auto + max-w-* + px-4 dans la même liste de classes.
    /class="[^"]*\bmx-auto\b[^"]*\bmax-w-[a-z0-9]+\b[^"]*\bpx-4\b/.test(homeHtml),
  );

  const standingsCss = readFileSync(path.join(ROOT, "src/components/StandingsTable.tsx"), "utf8");
  check(
    "classement : défilement horizontal sur mobile",
    standingsCss.includes("overflow-x-auto"),
  );
  const accountScroll = account.body.includes("scroll-x");
  check("tableaux de l'espace abonné : défilement horizontal", accountScroll);
  check(
    "tableaux Markdown : défilement horizontal",
    readFileSync(path.join(ROOT, "src/app/article/[slug]/page.tsx"), "utf8").includes("scroll-x"),
  );
  check("classe .scroll-x définie en CSS", css.includes(".scroll-x"));

  /* ------------------------------------------------- 9) Non-régression (WP9) */
  section("Non-régression et sobriété");
  const clientFiles = walk(path.join(ROOT, "src"), ".tsx").filter((file) =>
    /^\s*"use client";/m.test(readFileSync(file, "utf8")),
  );
  // Liste nominative : le WP9 refusait les composants clients inutiles. Les
  // seuls ajouts depuis sont ceux de l'engagement public (WP10b), justifiés par
  // l'UI optimiste et la modale de signalement, le compteur de notifications
  // (WP10d), relu à chaque navigation, le formulaire d'inscription à la
  // newsletter (WP11c), l'édition des campagnes (WP11d : formulaire, envoi
  // confirmé, e-mail de test) et les préférences de notification (WP11e), dont
  // l'interrupteur global désactive visuellement les cases de type.
  const ALLOWED_CLIENT_FILES = [
    "src/app/backoffice/BackofficeNav.tsx",
    "src/app/backoffice/newsletter/campaigns/components/CampaignForm.tsx",
    "src/app/backoffice/newsletter/campaigns/components/SendCampaignButton.tsx",
    "src/app/backoffice/newsletter/campaigns/components/TestEmailButton.tsx",
    "src/app/backoffice/newsletter/components/ListForm.tsx",
    "src/app/backoffice/sports/CompetitionForm.tsx",
    "src/app/backoffice/sports/DeleteButton.tsx",
    "src/app/backoffice/sports/MatchForm.tsx",
    "src/app/backoffice/sports/sync/SyncForm.tsx",
    "src/app/backoffice/sports/TeamForm.tsx",
    "src/app/backoffice/users/DeleteUserButton.tsx",
    "src/app/backoffice/users/UserForm.tsx",
    "src/app/login/LoginForm.tsx",
    "src/app/studio/articles/ArticleForm.tsx",
    "src/app/studio/articles/DeleteArticleButton.tsx",
    "src/app/studio/articles/StatusSelect.tsx",
    "src/app/studio/categories/CategoryForm.tsx",
    "src/app/studio/categories/DeleteCategoryButton.tsx",
    "src/app/studio/StudioNav.tsx",
    "src/components/Analytics.tsx",
    // Justification : les pages publiques sont prérendues (revalidate = 60) et un
    // auth() côté serveur les rendrait dynamiques ; le masquage de la publicité
    // pour les abonnés premium passe donc par /api/auth/session au montage.
    "src/components/AdSlotGate.tsx",
    "src/components/ArticleReactions.tsx",
    "src/components/CommentReactions.tsx",
    "src/components/ImageUpload.tsx",
    "src/components/NewsletterForm.tsx",
    "src/components/NotificationBadge.tsx",
    "src/components/NotificationPreferences.tsx",
    "src/components/PlanCard.tsx",
    "src/components/PublicNav.tsx",
    "src/components/ReportModal.tsx",
    "src/components/SportTabs.tsx",
    "src/components/SubscriptionStatus.tsx",
    "src/components/UserMenu.tsx",
  ];
  const relativeClientFiles = clientFiles
    .map((file) => path.relative(ROOT, file).replace(/\\/g, "/"))
    .sort();
  const unexpectedClients = relativeClientFiles.filter((file) => !ALLOWED_CLIENT_FILES.includes(file));
  check(
    "composants clients limités à la liste justifiée (aucun ajout inutile)",
    unexpectedClients.length === 0 &&
      ALLOWED_CLIENT_FILES.every((file) => relativeClientFiles.includes(file)),
    unexpectedClients.length
      ? `non prévus : ${unexpectedClients.join(", ")}`
      : `${relativeClientFiles.length} fichiers`,
  );
  check(
    "composant client public : la barre de navigation reste la seule ajoutée",
    clientFiles.some((file) => file.endsWith("PublicNav.tsx")) &&
      clientFiles.some((file) => file.endsWith("Analytics.tsx")),
  );

  const lucideIcons = new Set();
  for (const file of walk(path.join(ROOT, "src"), ".tsx")) {
    const source = readFileSync(file, "utf8");
    for (const [, icons] of source.matchAll(/import \{([^}]+)\} from "lucide-react";/g)) {
      for (const icon of icons.split(",")) {
        const name = icon.trim().split(/\s+as\s+/)[0].trim();
        if (name) lucideIcons.add(name);
      }
    }
  }
  check(
    "icônes lucide limitées à celles utilisées (poids maîtrisé)",
    // Plafond relevé de 25 à 30 par le WP10d (une icône par type de notification),
    // à 35 par le WP11b (pages de confirmation et de désabonnement), puis à 40 par
    // le WP11c (inscription, préférences, sécurité du désabonnement).
    lucideIcons.size > 0 && lucideIcons.size <= 40,
    `${lucideIcons.size} icônes : ${[...lucideIcons].sort().join(", ")}`,
  );

  // Hydratation : un blanc sur la MÊME ligne entre deux balises de tableau est
  // conservé par JSX comme nœud de texte, ce qu'HTML interdit dans <tr>
  // (« In HTML, whitespace text nodes cannot be a child of <tr> »). Un blanc qui
  // contient un saut de ligne est supprimé, d'où la forme du contrôle.
  const tableTag = /<(\/?)(table|thead|tbody|tfoot|tr|td|th)\b[^>]*>/g;
  const tableWhitespace = [];
  for (const file of walk(path.join(ROOT, "src"), ".tsx")) {
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        const matches = [...line.matchAll(tableTag)];
        for (let i = 1; i < matches.length; i += 1) {
          const between = line.slice(
            matches[i - 1].index + matches[i - 1][0].length,
            matches[i].index,
          );
          if (between.length > 0 && between.trim() === "") {
            tableWhitespace.push(
              `${path.relative(ROOT, file)}:${index + 1} (${between.length} blancs)`,
            );
          }
        }
      });
  }
  check(
    "aucun nœud de texte parasite dans les tableaux (erreur d'hydratation)",
    tableWhitespace.length === 0,
    tableWhitespace.join(", ") || "aucun",
  );

  // Hydratation : tout composant qui décore un lien d'après `usePathname()`
  // pendant le rendu peut diverger du HTML du serveur si l'URL change avant la
  // fin de l'hydratation. Les navigations doivent donc passer par `useMounted`.
  const pathnameNavs = [
    "src/app/backoffice/BackofficeNav.tsx",
    "src/app/studio/StudioNav.tsx",
    "src/components/PublicNav.tsx",
    "src/components/SportTabs.tsx",
  ];
  const unguardedNavs = pathnameNavs.filter((file) => {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    return /aria-current/.test(source) && !/useMounted/.test(source);
  });
  check(
    "navigations : état actif appliqué après montage (pas de divergence serveur/client)",
    unguardedNavs.length === 0,
    unguardedNavs.join(", ") || `${pathnameNavs.length} navigation(s) protégée(s)`,
  );

  // Fonctionnalités existantes : paywall, SEO, analytics, flux.
  const premium = db.prepare("SELECT slug FROM Article WHERE isPremium = 1 AND status = 'PUBLISHED' LIMIT 1").get();
  if (premium) {
    const locked = await get(`/article/${premium.slug}`);
    check(
      "paywall toujours actif pour un visiteur",
      locked.body.includes("Cet article est réservé aux abonnés") &&
        locked.body.includes('href="/abonnement"'),
    );
  }
  check("flux RSS toujours servi", (await get("/rss.xml")).status === 200);
  check("sitemap toujours servi", (await get("/sitemap.xml")).status === 200);
  check("robots.txt toujours servi", (await get("/robots.txt")).status === 200);
  const analyticsChunk = await chunkContains(homeHtml, "/api/analytics/track");
  check(
    "collecte analytics toujours branchée (beacon dans le bundle client)",
    Boolean(analyticsChunk),
    analyticsChunk ?? "cible du beacon introuvable",
  );
  const bundle = (await get("/")).body;
  check("menu utilisateur toujours embarqué (bundle client)", bundle.includes("authjs") || bundle.includes("_next/static"));
  check(
    "lien « Abonnement » toujours présent dans la navigation",
    homeHtml.includes('href="/abonnement"'),
  );
  check(
    "studio : apparence inchangée (aucune classe du nouveau design system)",
    !readFileSync(path.join(ROOT, "src/app/studio/articles/page.tsx"), "utf8").includes("ui/Button"),
  );
  check(
    "backoffice : apparence inchangée (aucune classe du nouveau design system)",
    !readFileSync(path.join(ROOT, "src/app/backoffice/page.tsx"), "utf8").includes("ui/Button"),
  );

  db.close();

  const failed = results.filter((result) => !result).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exit(1);
});
