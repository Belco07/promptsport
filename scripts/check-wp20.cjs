/**
 * WP20 — Mise à jour des thèmes éditoriaux.
 *
 * Vérifie la désactivation de « Transferts », la réaffectation de ses articles
 * vers « Mercato », la création des quatre nouveaux thèmes, l'idempotence du
 * seed, le registre d'icônes, puis les effets visibles : 8 onglets sur l'accueil,
 * 8 thèmes sur /themes, 404 sur /theme/transferts, pages des nouveaux thèmes.
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp20.cjs
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const Database = require("./lib/pg-sync.cjs");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);

const NEW_THEMES = [
  { slug: "blessures", name: "Blessures", icon: "HeartPulse", color: "#ef4444" },
  { slug: "polemiques", name: "Polémiques", icon: "Flame", color: "#f97316" },
  { slug: "power-ranking", name: "Power Ranking", icon: "TrendingUp", color: "#8b5cf6" },
  { slug: "opinion", name: "Opinion", icon: "MessageSquareQuote", color: "#0ea5e9" },
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
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  /* ------------------------------------------------------- 1) migration */
  section("Migration SQL");
  const migrationsDir = path.join(ROOT, "prisma", "migrations");
  const migration = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.includes("update_editorial_themes"))
    .sort()
    .at(-1);
  check("migration manuelle présente", Boolean(migration), migration ?? "aucune");

  if (migration) {
    const sql = fs.readFileSync(path.join(migrationsDir, migration, "migration.sql"), "utf8");
    check(
      "désactivation de « transferts »",
      /UPDATE "Theme" SET active = false[^;]*WHERE slug = 'transferts'/.test(sql),
    );
    check(
      "réaffectation des articles vers « mercato »",
      /INSERT INTO "_ArticleToTheme"[\s\S]*WHERE slug = 'mercato'/.test(sql) && /ON CONFLICT DO NOTHING/.test(sql),
    );
    check(
      "suppression des anciennes associations",
      /DELETE FROM "_ArticleToTheme" WHERE "B" = \(SELECT id FROM "Theme" WHERE slug = 'transferts'\)/.test(sql),
    );
    check(
      "ordre sûr : réaffecter avant de supprimer",
      sql.indexOf("INSERT INTO") < sql.indexOf("DELETE FROM"),
    );
  }

  /* ------------------------------------------------------------ 2) seed */
  section("Seed");
  const seed = readSource("prisma/seed.cjs");
  // WP20 : les thèmes vivent dans la source partagée `prisma/default-themes.cjs`,
  // consommée par `prisma/seed.cjs` (dev) et `prisma/seed-themes.cjs` (production).
  const defaultThemes = readSource("prisma/default-themes.cjs");
  check(
    "les quatre nouveaux thèmes sont déclarés",
    NEW_THEMES.every(
      (theme) => defaultThemes.includes(`slug: "${theme.slug}"`) && defaultThemes.includes(`icon: "${theme.icon}"`),
    ),
  );
  check(
    "couleurs des nouveaux thèmes",
    NEW_THEMES.every((theme) => defaultThemes.includes(`color: "${theme.color}"`)),
  );
  check(
    "« transferts » désactivé dans le seed",
    /slug: "transferts"[\s\S]{0,200}active: false/.test(defaultThemes),
  );
  check(
    "le seed partage cette source (dev + production)",
    seed.includes('require("./default-themes.cjs")') &&
      readSource("prisma/seed-themes.cjs").includes('require("./default-themes.cjs")'),
  );
  check(
    "le seed met à jour `active` sur un thème existant",
    /UPDATE Theme SET name = \?, description = \?, color = \?, icon = \?, active = \?/.test(seed),
  );

  /* -------------------------------------------------- 3) registre d'icônes */
  section("Registre d'icônes");
  const themesLib = readSource("src/lib/themes.ts");
  check(
    "les quatre icônes sont enregistrées",
    NEW_THEMES.every((theme) => new RegExp(`^\\s+${theme.icon},`, "m").test(themesLib)),
  );

  /* ------------------------------------------------------- 4) base */
  section("Base de données");
  const db = new Database();
  const themes = db.prepare('SELECT id, slug, name, color, icon, active FROM "Theme" ORDER BY slug').all();
  const bySlug = Object.fromEntries(themes.map((theme) => [theme.slug, theme]));
  // La passerelle synchrone rend les booléens PostgreSQL en 1/0.
  const isActive = (row) => row?.active === true || row?.active === 1;

  check("9 thèmes en base (5 historiques + 4 nouveaux)", themes.length === 9, `${themes.length} thème(s)`);
  check(
    "8 thèmes actifs",
    themes.filter(isActive).length === 8,
    themes.filter(isActive).map((theme) => theme.slug).join(", "),
  );
  check(
    "« transferts » désactivé et conservé",
    bySlug.transferts !== undefined && !isActive(bySlug.transferts),
    `active=${bySlug.transferts?.active}`,
  );
  check("« mercato » toujours actif", isActive(bySlug.mercato));
  for (const theme of NEW_THEMES) {
    const row = bySlug[theme.slug];
    check(
      `thème « ${theme.name} » créé (icône + couleur + actif)`,
      isActive(row) && row?.icon === theme.icon && row?.color === theme.color,
      row ? `${row.icon} ${row.color}` : "absent",
    );
  }

  const transfertLinks = db
    .prepare('SELECT count(*) AS n FROM "_ArticleToTheme" WHERE "B" = ?')
    .get(bySlug.transferts.id).n;
  check("plus aucune association sur « transferts »", transfertLinks === 0, `${transfertLinks} liaison(s)`);

  // Idempotence : relancer le seed ne doit rien créer de plus.
  const before = themes.length;
  execFileSync(process.execPath, [path.join(ROOT, "prisma", "seed.cjs")], { cwd: ROOT, stdio: "ignore" });
  const after = db.prepare('SELECT count(*) AS n FROM "Theme"').get().n;
  check("seed idempotent (aucun doublon)", after === before, `${before} -> ${after} thème(s)`);

  /* --------------------- 5) réaffectation (fixture, logique de la migration) */
  section("Réaffectation des articles");
  const author = db.prepare("SELECT id FROM Author ORDER BY createdAt LIMIT 1").get();
  const category = db.prepare("SELECT id FROM Category ORDER BY name LIMIT 1").get();
  const articleId = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const slug = `test-wp20-reaffectation-${Date.now().toString(36)}`;
  try {
    db.prepare(
      `INSERT INTO Article (id, title, slug, content, excerpt, status, format, "publishedAt", "authorId", "categoryId", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', 'NEWS', CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(articleId, "Article de test WP20", slug, "Contenu.", "Extrait.", author.id, category.id);
    db.prepare('INSERT INTO "_ArticleToTheme" ("A", "B") VALUES (?, ?)').run(articleId, bySlug.transferts.id);

    // Mêmes instructions que la migration, rejouées sur la fixture.
    db.prepare(
      `INSERT INTO "_ArticleToTheme" ("A", "B")
       SELECT j."A", (SELECT id FROM "Theme" WHERE slug = 'mercato')
       FROM "_ArticleToTheme" j
       WHERE j."B" = (SELECT id FROM "Theme" WHERE slug = 'transferts')`,
    ).run();
    db.prepare('DELETE FROM "_ArticleToTheme" WHERE "B" = (SELECT id FROM "Theme" WHERE slug = \'transferts\')').run();

    const linked = db
      .prepare('SELECT t.slug FROM "_ArticleToTheme" j JOIN "Theme" t ON t.id = j."B" WHERE j."A" = ?')
      .all(articleId)
      .map((row) => row.slug);
    check(
      "l'article passe de « transferts » à « mercato »",
      linked.length === 1 && linked[0] === "mercato",
      linked.join(", ") || "aucune association",
    );
  } finally {
    db.prepare('DELETE FROM "_ArticleToTheme" WHERE "A" = ?').run(articleId);
    db.prepare("DELETE FROM Article WHERE id = ?").run(articleId);
    const left = db.prepare("SELECT count(*) AS n FROM Article WHERE slug LIKE ?").get("test-wp20-%");
    console.log(`   (article de test supprimé, restants = ${left.n})`);
  }
  db.close();

  /* --------------------------------------------------------- 6) affichage */
  section("Affichage");
  // Les données de l'accueil sont mises en cache 60 s (`unstable_cache`) : après
  // le seed, on laisse la fenêtre expirer plutôt que de conclure trop vite.
  let cleanHome = "";
  let tabCount = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const home = await get("/");
    cleanHome = stripComments(home.body);
    tabCount = (cleanHome.match(/role="tab"/g) ?? []).length;
    if (tabCount === 8) break;
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
  check("accueil rendu", cleanHome.length > 0, "contenu reçu");
  check("8 onglets thématiques sur l'accueil", tabCount === 8, `${tabCount} onglet(s)`);
  check(
    "les nouveaux thèmes sont dans les onglets",
    ["Blessures", "Polémiques", "Power Ranking", "Opinion"].every((name) => cleanHome.includes(name)),
  );
  check("« Transferts » absent des onglets", !/role="tab"[^>]*>[^<]*Transferts/.test(cleanHome));

  const themesPage = await get("/themes");
  const cleanThemes = stripComments(themesPage.body);
  check("page /themes rendue", themesPage.status === 200, `status=${themesPage.status}`);
  const cards = (cleanThemes.match(/href="\/theme\//g) ?? []).length;
  check("8 cartes de thèmes actifs", cards === 8, `${cards} carte(s)`);
  // La description SEO de la page mentionne encore l'ancienne liste (fichier
  // hors périmètre WP20) : le contrôle porte donc sur les cartes.
  check("aucune carte vers le thème désactivé", !cleanThemes.includes('href="/theme/transferts"'));

  const disabled = await get("/theme/transferts");
  check("thème désactivé : 404", disabled.status === 404, `status=${disabled.status}`);

  for (const theme of ["blessures", "power-ranking", "polemiques", "opinion"]) {
    const page = await get(`/theme/${theme}`);
    check(`/theme/${theme} accessible`, page.status === 200, `status=${page.status}`);
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
