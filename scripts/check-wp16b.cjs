/**
 * WP16b — Sélecteur de thèmes dans le studio.
 *
 * Vérifie le composant `ThemeSelector`, son branchement dans le formulaire, la
 * lecture des thèmes par les Server Actions `createArticle` / `updateArticle`,
 * l'affichage dans la liste du studio et dans les métadonnées publiques, puis
 * l'enregistrement réel des associations en base (création, pré-sélection à
 * l'édition, remplacement à la mise à jour).
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp16b.cjs
 *
 * Protocole des Server Actions reproduit comme dans check-articles-crud.cjs :
 *   formulaire simple          -> champ caché $ACTION_ID_<id>
 *   formulaire useActionState  -> $ACTION_REF_<n> + $ACTION_<n>:0 (action liée)
 *                                 + $ACTION_<n>:1 (arguments) + $ACTION_KEY
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("./lib/pg-sync.cjs");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const BASE = `http://${HOST}:${PORT}`;
const THEME_SLUG = "mercato";
const SECOND_THEME_SLUG = "tactique";

/** Thèmes actifs après le WP20 (8 sur 9 : « transferts » est désactivé). */
const ACTIVE_THEME_NAMES = [
  "Mercato",
  "Tactique",
  "Interviews",
  "Compétitions",
  "Blessures",
  "Polémiques",
  "Power Ranking",
  "Opinion",
];

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`OK    | ${label}${detail ? ` -> ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`ECHEC | ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

const readSource = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function createJar() {
  const store = new Map();
  return {
    absorb(setCookieHeaders) {
      for (const raw of setCookieHeaders ?? []) {
        const pair = raw.split(";")[0];
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    has: (name) => Boolean(store.get(name)),
  };
}

function request(method, urlPath, { jar, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = {};
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers }, (res) => {
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
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const unescapeHtml = (value) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** Formulaire `useActionState` : $ACTION_REF_n + $ACTION_n:0 (action liée) + $ACTION_n:1. */
function extractActionRef(html) {
  const ref = html.match(/name="\$ACTION_REF_(\d+)"/);
  if (!ref) return null;
  const n = ref[1];
  const bound = html.match(new RegExp(`name="\\$ACTION_${n}:0"\\s+value="([^"]+)"`));
  const args = html.match(new RegExp(`name="\\$ACTION_${n}:1"\\s+value="([^"]+)"`));
  const key = html.match(/name="\$ACTION_KEY"\s+value="([^"]+)"/);
  if (!bound) return null;
  const boundValue = unescapeHtml(bound[1]);
  const idMatch = boundValue.match(/"id"\s*:\s*"([0-9a-f]+)"/);
  return {
    kind: "action-ref",
    actionId: idMatch ? idMatch[1] : null,
    refField: `$ACTION_REF_${n}`,
    boundName: `$ACTION_${n}:0`,
    boundValue,
    argName: `$ACTION_${n}:1`,
    argValue: args ? unescapeHtml(args[1]) : '["$undefined"]',
    actionKey: key ? key[1] : null,
  };
}

/** POST multipart reproduisant la soumission du navigateur. */
function submitForm(jar, pagePath, spec, fields) {
  if (!spec?.actionId) {
    throw new Error(`Action serveur introuvable pour ${pagePath}`);
  }
  const all =
    spec.kind === "action-id"
      ? { [`$ACTION_ID_${spec.actionId}`]: "", ...fields }
      : {
          [spec.refField]: "",
          ...fields,
          [spec.boundName]: spec.boundValue,
          [spec.argName]: spec.argValue,
          ...(spec.actionKey ? { $ACTION_KEY: spec.actionKey } : {}),
        };

  const boundary = `----WP16B${Math.random().toString(36).slice(2)}`;
  const parts = [];
  for (const [name, value] of Object.entries(all)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: pagePath,
        method: "POST",
        headers: {
          cookie: jar.header(),
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": payload.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function loginAs(email, password) {
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email, password, callbackUrl: `${BASE}/studio/articles` },
  });
  return jar;
}

async function main() {
  /* ------------------------------------------------- 1) composant et form */
  section("Composant ThemeSelector");
  const selector = readSource("src/components/studio/ThemeSelector.tsx");
  check("composant créé", selector.includes("export function ThemeSelector"));
  check("Client Component", selector.includes('"use client"'));
  check(
    "props value / onChange",
    selector.includes("value: string[]") && selector.includes("onChange: (themeIds: string[]) => void"),
  );
  check(
    "badges colorés via themeBadgeStyle",
    selector.includes("themeBadgeStyle") && selector.includes('"@/lib/themes"'),
  );
  // Le registre d'icônes a été déplacé dans src/lib/themes.ts au WP16c.
  check("icône lue depuis theme.icon", selector.includes("themeIcon(theme.icon)"));
  check(
    "accessibilité : role checkbox et aria-checked",
    selector.includes('role="checkbox"') && selector.includes("aria-checked={selected}"),
  );
  check("état inactif à opacité réduite", selector.includes("opacity: 0.5"));

  section("Formulaire d'article");
  const form = readSource("src/app/studio/articles/ArticleForm.tsx");
  check(
    "sélecteur importé et rendu",
    form.includes("<ThemeSelector themes={themes} value={themeIds} onChange={setThemeIds} />"),
  );
  check("placé après le champ Catégorie", form.indexOf("<ThemeSelector") > form.indexOf('id="categoryId"'));
  check(
    "champ caché themeIds (JSON)",
    form.includes('name="themeIds"') && form.includes("JSON.stringify(themeIds)"),
  );
  check("thèmes initiaux repris des valeurs par défaut", form.includes("useState<string[]>(initial.themeIds)"));

  /* --------------------------------------------------------- 2) actions */
  section("Server Actions");
  const actions = readSource("src/app/studio/articles/actions.ts");
  check("lecture du champ themeIds", actions.includes("function readThemeIds(formData: FormData)"));
  check("validation des identifiants en base", actions.includes("async function keepExistingThemeIds"));
  check("création : connexion des thèmes", /themes: \{ connect: linkedThemeIds\.map/.test(actions));
  check("mise à jour : remplacement des associations", /themes: \{ set: linkedThemeIds\.map/.test(actions));
  check("garde-fou sur le nombre de thèmes", actions.includes("MAX_ARTICLE_THEMES"));

  /* -------------------------------------------------- 3) affichages */
  section("Liste du studio et page publique");
  const listPage = readSource("src/app/studio/articles/page.tsx");
  check(
    "colonne Thèmes dans la liste",
    listPage.includes(">Thèmes<") && listPage.includes("article.themes.map") && listPage.includes("themeBadgeStyle"),
  );
  const meta = readSource("src/components/ArticleMeta.tsx");
  check(
    "métadonnées : badges liés vers /theme/[slug]",
    meta.includes("themes") && meta.includes("href={`/theme/${theme.slug}`}") && meta.includes("themeBadgeStyle"),
  );
  const publicPage = readSource("src/app/article/[slug]/page.tsx");
  check(
    "page article : thèmes chargés et transmis",
    publicPage.includes("themes: { where: { active: true }") && publicPage.includes("themes={article.themes}"),
  );
  check(
    "page /theme/[slug] créée depuis (WP16c)",
    fs.existsSync(path.join(ROOT, "src/app/theme/[slug]/page.tsx")),
  );
  check("styles de badge présents", readSource("src/app/globals.css").includes(".theme-badge"));

  /* ------------------------------------------------------- 4) base de test */
  section("Enregistrement réel des thèmes");
  const db = new Database();
  const themes = db.prepare("SELECT id, slug, name FROM Theme WHERE active = true ORDER BY name").all();
  const mercato = db.prepare("SELECT id, slug FROM Theme WHERE slug = ?").get(THEME_SLUG);
  const tactique = db.prepare("SELECT id, slug FROM Theme WHERE slug = ?").get(SECOND_THEME_SLUG);
  check("thèmes du seed disponibles", Boolean(mercato && tactique), `${themes.length} actif(s)`);

  const slug = `test-themes-wp16b-${Date.now().toString(36)}`;
  const adminJar = await loginAs("admin@example.com", "admin123");
  check("session ADMIN établie", adminJar.has("authjs.session-token"));

  let articleId = null;
  try {
    /* Création avec deux thèmes. */
    const newPage = await request("GET", "/studio/articles/new", { jar: adminJar });
    check("formulaire de création rendu", newPage.status === 200, `status=${newPage.status}`);
    check(
      "le sélecteur affiche les thèmes actifs",
      ACTIVE_THEME_NAMES.every((name) => newPage.body.includes(name)),
    );
    check("le thème désactivé n'est pas proposé", !newPage.body.includes(">Transferts<"));
    check("cases à cocher accessibles dans le HTML", newPage.body.includes('role="checkbox"'));

    // Le formulaire d'article est un formulaire `useActionState` : l'action est
    // portée par $ACTION_REF_n (et non par un champ $ACTION_ID_).
    const createSpec = extractActionRef(newPage.body);
    check("action de création détectée", Boolean(createSpec?.actionId), createSpec?.actionId?.slice(0, 12));

    const category = db.prepare("SELECT id FROM Category ORDER BY name LIMIT 1").get();
    const created = await submitForm(adminJar, "/studio/articles/new", createSpec, {
      title: "Test thèmes WP16b",
      slug,
      content: "Contenu de test pour les thèmes.",
      excerpt: "",
      coverImageUrl: "",
      categoryId: category.id,
      status: "PUBLISHED",
      format: "NEWS",
      themeIds: JSON.stringify([mercato.id, tactique.id]),
    });
    check("création acceptée", created.status === 200 || created.status === 303, `status=${created.status}`);

    const stored = db.prepare("SELECT id FROM Article WHERE slug = ?").get(slug);
    articleId = stored?.id ?? null;
    check("article créé", Boolean(articleId), articleId ?? "introuvable");

    const linked = articleId
      ? db
          .prepare('SELECT t.slug FROM "_ArticleToTheme" j JOIN Theme t ON t.id = j."B" WHERE j."A" = ? ORDER BY t.slug')
          .all(articleId)
      : [];
    check(
      "les deux thèmes sont associés en base",
      linked.length === 2 && linked.some((row) => row.slug === THEME_SLUG) && linked.some((row) => row.slug === SECOND_THEME_SLUG),
      linked.map((row) => row.slug).join(", "),
    );

    /* Pré-sélection à l'édition. */
    const editPage = await request("GET", `/studio/articles/${articleId}/edit`, { jar: adminJar });
    check("page d'édition rendue", editPage.status === 200, `status=${editPage.status}`);
    const checkedCount = (editPage.body.match(/aria-checked="true"/g) ?? []).length;
    check("thèmes déjà associés pré-sélectionnés", checkedCount >= 2, `${checkedCount} case(s) cochée(s)`);

    /* Mise à jour : remplacement des associations. */
    const updateSpec = extractActionRef(editPage.body);
    check("action de mise à jour détectée", Boolean(updateSpec?.actionId), updateSpec?.actionId?.slice(0, 12));
    const updated = await submitForm(adminJar, `/studio/articles/${articleId}/edit`, updateSpec, {
      title: "Test thèmes WP16b",
      slug,
      content: "Contenu de test pour les thèmes (mis à jour).",
      excerpt: "",
      coverImageUrl: "",
      categoryId: category.id,
      status: "PUBLISHED",
      format: "NEWS",
      themeIds: JSON.stringify([tactique.id]),
    });
    check("mise à jour acceptée", updated.status === 200 || updated.status === 303, `status=${updated.status}`);

    const afterUpdate = articleId
      ? db.prepare('SELECT t.slug FROM "_ArticleToTheme" j JOIN Theme t ON t.id = j."B" WHERE j."A" = ?').all(articleId)
      : [];
    check(
      "les associations sont remplacées (plus qu'un thème)",
      afterUpdate.length === 1 && afterUpdate[0].slug === SECOND_THEME_SLUG,
      afterUpdate.map((row) => row.slug).join(", ") || "aucune",
    );

    /* Liste du studio. */
    const studioList = await request("GET", "/studio/articles", { jar: adminJar });
    check("liste du studio : colonne Thèmes", studioList.body.includes(">Thèmes<"));
    check(
      "liste du studio : badge du thème associé",
      studioList.body.includes("Tactique") && studioList.body.includes("theme-badge"),
    );

    /* Page publique. */
    const publicArticle = await request("GET", `/article/${slug}`);
    check("article public rendu", publicArticle.status === 200, `status=${publicArticle.status}`);
    check(
      "thème affiché à côté de la catégorie",
      publicArticle.body.includes(`href="/theme/${SECOND_THEME_SLUG}"`) && publicArticle.body.includes("Tactique"),
    );

    /* Thème inconnu ignoré. */
    const forged = await submitForm(adminJar, `/studio/articles/${articleId}/edit`, updateSpec, {
      title: "Test thèmes WP16b",
      slug,
      content: "Contenu de test pour les thèmes (identifiant forgé).",
      excerpt: "",
      coverImageUrl: "",
      categoryId: category.id,
      status: "PUBLISHED",
      format: "NEWS",
      themeIds: JSON.stringify(["identifiant-inexistant"]),
    });
    const afterForged = articleId
      ? db.prepare('SELECT count(*) AS n FROM "_ArticleToTheme" WHERE "A" = ?').get(articleId)
      : { n: -1 };
    check(
      "identifiant de thème inconnu ignoré (aucune association)",
      (forged.status === 200 || forged.status === 303) && afterForged.n === 0,
      `status=${forged.status}, associations=${afterForged.n}`,
    );
  } finally {
    if (articleId) {
      db.prepare('DELETE FROM "_ArticleToTheme" WHERE "A" = ?').run(articleId);
      db.prepare("DELETE FROM Article WHERE id = ?").run(articleId);
    }
    const left = db.prepare("SELECT count(*) AS n FROM Article WHERE slug LIKE ?").get("test-themes-wp16b-%");
    console.log(`   (article de test supprimé, restants = ${left.n})`);
    const orphan = db.prepare('SELECT count(*) AS n FROM "_ArticleToTheme"').get();
    console.log(`   (associations restantes en base : ${orphan.n})`);
    db.close();
  }

  console.log(`\nRESULTAT: ${passed}/${passed + failed} vérifications réussies`);
  if (failed > 0) {
    console.log(`ECHEC : ${failed} vérification(s) en échec`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ECHEC | exécution de la suite :", error);
  process.exitCode = 1;
});
