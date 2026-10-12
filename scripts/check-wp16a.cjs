/**
 * WP16a — Modèle de données Themes.
 *
 * Vérifie le schéma Prisma (modèle `Theme` + relation many-to-many implicite
 * avec `Article`), la migration `add_theme_model`, les 5 thèmes du seed, les
 * helpers de `src/lib/themes.ts`, la page `/backoffice/themes`, le lien de la
 * sidebar et — au niveau base — l'association réelle d'un thème à un article.
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp16a.cjs
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const BASE = `http://${HOST}:${PORT}`;

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z]/.test(line))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

const DEFAULT_THEME_SLUGS = ["mercato", "tactique", "interviews", "competitions", "transferts", "blessures", "polemiques", "power-ranking", "opinion"];

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
    absorb(rawCookies) {
      for (const raw of rawCookies ?? []) {
        const [pair] = raw.split(";");
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

async function loginAs(email, password) {
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email, password, callbackUrl: `${BASE}/backoffice/themes` },
  });
  return jar;
}

async function main() {
  /* ------------------------------------------------------------- 1) schéma */
  section("Schéma Prisma");
  const schema = readSource("prisma/schema.prisma");
  const themeModel = /model Theme \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
  check("modèle Theme présent", themeModel.length > 0);
  check(
    "champs attendus (id, name, slug, description, color, icon, active, createdAt, updatedAt)",
    ["id ", "name ", "slug ", "description ", "color ", "icon ", "active ", "createdAt ", "updatedAt "].every(
      (field) => themeModel.includes(field),
    ),
  );
  check("slug unique", /slug\s+String\s+@unique/.test(themeModel));
  check("active par défaut à true", /active\s+Boolean\s+@default\(true\)/.test(themeModel));
  check("relation vers Article déclarée", /articles\s+Article\[\]/.test(themeModel));
  check(
    "relation many-to-many côté Article",
    /model Article \{[\s\S]*?themes\s+Theme\[\][\s\S]*?\n\}/.test(schema),
  );
  check(
    "jointure implicite (aucun modèle _ArticleToTheme déclaré)",
    !schema.includes("model _ArticleToTheme"),
  );
  const categoryModel = /model Category \{[\s\S]*?\n\}/.exec(schema)?.[0] ?? "";
  check(
    "modèle Category inchangé (aucun champ thème)",
    categoryModel.length > 0 && !/theme/i.test(categoryModel),
  );

  /* --------------------------------------------------------- 2) migration */
  section("Migration add_theme_model");
  const migrationsDir = path.join(ROOT, "prisma", "migrations");
  const migration = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith("_add_theme_model"))
    .sort()
    .at(-1);
  check("dossier de migration présent", Boolean(migration), migration ?? "aucun");
  if (migration) {
    const sql = fs.readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8");
    check("table Theme créée", /CREATE TABLE "Theme"/.test(sql));
    check("table de jointure créée", /CREATE TABLE "_ArticleToTheme"/.test(sql));
    check(
      "clés étrangères vers Article et Theme",
      /_ArticleToTheme_A_fkey/.test(sql) && /_ArticleToTheme_B_fkey/.test(sql),
    );
  }

  /* -------------------------------------------------------------- 3) seed */
  section("Thèmes par défaut");
  const seed = readSource("prisma/seed.cjs");
  const defaultThemes = readSource("prisma/default-themes.cjs");
  check(
    "les 9 thèmes sont déclarés dans la source partagée",
    DEFAULT_THEME_SLUGS.every((slug) => defaultThemes.includes(`slug: "${slug}"`)),
    DEFAULT_THEME_SLUGS.join(", "),
  );
  check(
    "le seed consomme la source partagée (default-themes.cjs)",
    seed.includes('require("./default-themes.cjs")'),
  );
  check("seed idempotent (mise à jour par slug)", seed.includes("UPDATE Theme SET"));

  /* ---------------------------------------------------------- 4) helpers */
  section("Helpers src/lib/themes.ts");
  const helpers = readSource("src/lib/themes.ts");
  check(
    "helpers d'affichage exportés",
    helpers.includes("export function themeBadgeStyle") &&
      helpers.includes("export function themeTextColor") &&
      helpers.includes("export function normaliseThemeColor") &&
      helpers.includes("THEME_FALLBACK_COLOR"),
  );

  /* ------------------------------------------------- 5) page et sidebar */
  section("Backoffice");
  const page = readSource("src/app/backoffice/themes/page.tsx");
  check("page /backoffice/themes créée", page.includes("prisma.theme.findMany"));
  check(
    "colonnes nom, slug, articles, actif",
    ["Nom", "Slug", "Articles", "Actif"].every((header) => page.includes(header)),
  );
  check("comptage des articles via _count", page.includes("_count") && page.includes("articles: true"));
  const nav = readSource("src/app/backoffice/BackofficeNav.tsx");
  check(
    "lien « Thèmes » dans la sidebar",
    nav.includes('href="/backoffice/themes"') && nav.includes("Thèmes"),
  );

  /* --------------------------------------------------------- 6) base de données */
  section("Base de données");
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const applied = await db.query(
    'SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name LIKE $1',
    ["%add_theme_model"],
  );
  check(
    "migration appliquée",
    applied.rowCount === 1 && applied.rows[0].finished_at !== null,
    applied.rows[0]?.migration_name ?? "introuvable",
  );

  const themes = await db.query('SELECT id, name, slug, active, color FROM "Theme" ORDER BY name');
  // WP20 : 5 thèmes historiques + 4 nouveaux, dont « transferts » désactivé.
  check("9 thèmes en base", themes.rowCount === 9, `${themes.rowCount} thème(s)`);
  check(
    "les 9 slugs attendus",
    DEFAULT_THEME_SLUGS.every((slug) => themes.rows.some((row) => row.slug === slug)),
    themes.rows.map((row) => row.slug).join(", "),
  );
  check(
    "8 thèmes actifs (transferts désactivé au WP20)",
    themes.rows.filter((row) => row.active === true).length === 8,
  );
  check(
    "« transferts » conservé mais désactivé",
    themes.rows.some((row) => row.slug === "transferts" && row.active === false),
  );

  // Association réelle d'un thème à un article (ce que fait Prisma Studio).
  const article = (await db.query('SELECT id FROM "Article" ORDER BY "createdAt" LIMIT 1')).rows[0];
  const linkedThemes = themes.rows.slice(0, 2);
  let linkOk = false;
  if (article && linkedThemes.length === 2) {
    try {
      for (const theme of linkedThemes) {
        await db.query('INSERT INTO "_ArticleToTheme" ("A", "B") VALUES ($1, $2) ON CONFLICT DO NOTHING', [
          article.id,
          theme.id,
        ]);
      }
      const joined = await db.query(
        'SELECT count(*)::int AS n FROM "_ArticleToTheme" WHERE "A" = $1',
        [article.id],
      );
      linkOk = joined.rows[0].n >= 2;
      check("association article ↔ thèmes possible", linkOk, `${joined.rows[0].n} thème(s) lié(s)`);
    } finally {
      await db.query('DELETE FROM "_ArticleToTheme" WHERE "A" = $1', [article.id]);
      const left = await db.query('SELECT count(*)::int AS n FROM "_ArticleToTheme" WHERE "A" = $1', [
        article.id,
      ]);
      console.log(`   (liaisons de test supprimées, restantes = ${left.rows[0].n})`);
    }
  }

  const counts = await db.query(
    `SELECT t."name", count(a."A")::int AS n
     FROM "Theme" t LEFT JOIN "_ArticleToTheme" a ON a."B" = t."id"
     GROUP BY t."name" ORDER BY t."name"`,
  );
  check(
    "le comptage par thème est calculable",
    counts.rowCount === 9,
    counts.rows.map((row) => `${row.name}:${row.n}`).join(", "),
  );
  await db.end();

  /* --------------------------------------------------------------- 7) HTTP */
  section("Page /backoffice/themes");
  const adminJar = await loginAs("admin@example.com", "admin123");
  check("session ADMIN établie", adminJar.has("authjs.session-token"));
  const adminPage = await request("GET", "/backoffice/themes", { jar: adminJar });
  check("ADMIN : page accessible", adminPage.status === 200, `status=${adminPage.status}`);
  check(
    "les thèmes actifs et désactivés sont affichés",
    ["Mercato", "Tactique", "Interviews", "Compétitions", "Transferts", "Blessures", "Polémiques", "Power Ranking", "Opinion"].every((name) =>
      adminPage.body.includes(name),
    ),
  );
  check(
    "tableau avec ses en-têtes",
    ["Nom", "Slug", "Articles", "Actif"].every((header) => adminPage.body.includes(`>${header}<`)),
  );
  check("sidebar : lien Thèmes présent", adminPage.body.includes('href="/backoffice/themes"'));

  const journalistJar = await loginAs("journalist@example.com", "password123");
  const journalistPage = await request("GET", "/backoffice/themes", { jar: journalistJar });
  check(
    "JOURNALIST redirigé (réservé aux ADMIN)",
    journalistPage.status === 307 || journalistPage.status === 302,
    `status=${journalistPage.status} location=${journalistPage.location}`,
  );

  const anonymous = await request("GET", "/backoffice/themes");
  check(
    "visiteur redirigé vers /login",
    anonymous.status === 307 && String(anonymous.location).includes("/login"),
    `status=${anonymous.status} location=${anonymous.location}`,
  );

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
