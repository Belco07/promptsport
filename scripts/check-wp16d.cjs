/**
 * WP16d — Intégration des thèmes sur l'accueil.
 *
 * Vérifie le bloc d'onglets thématiques (accès clavier, état vide), la page
 * /themes, le remplacement du bloc Mercato (thème au lieu de la catégorie), le
 * bloc Analyses (format ANALYSIS + lien vers le thème Tactique) et le lien
 * « Tous les thèmes ».
 *
 * Le filtre du bloc Mercato est vérifié au niveau SQL : la page d'accueil est
 * mise en cache 60 s (`unstable_cache`), un article publié n'y apparaît donc pas
 * forcément dans la seconde. Le contrôle décisif porte sur la requête ellemême
 * (thème `mercato` contre catégorie sportive), puis sur le HTML rendu.
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp16d.cjs
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Database = require("./lib/pg-sync.cjs");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);

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

/** Retire les commentaires React : ils coupent les libellés interpolés. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

async function main() {
  /* ------------------------------------------------------ 1) composants */
  section("Composants");
  const tabs = readSource("src/components/ThemeTabs.tsx");
  check("ThemeTabs créé", tabs.includes("export function ThemeTabs"));
  check("Client Component", tabs.includes('"use client"'));
  check(
    "structure d'onglets accessible",
    tabs.includes('role="tablist"') &&
      tabs.includes('role="tab"') &&
      tabs.includes('role="tabpanel"') &&
      tabs.includes("aria-selected={selected}") &&
      tabs.includes("aria-controls="),
  );
  check(
    "navigation au clavier (flèches, Origine, Fin)",
    tabs.includes('event.key === "ArrowRight"') &&
      tabs.includes('event.key === "ArrowLeft"') &&
      tabs.includes('event.key === "Home"') &&
      tabs.includes('event.key === "End"'),
  );
  check("un seul onglet dans l'ordre de tabulation", tabs.includes("tabIndex={selected ? 0 : -1}"));
  check("message d'état vide", tabs.includes("Aucun article pour ce thème."));
  check(
    "badge coloré avec icône du thème",
    tabs.includes("themeBadgeStyle") && tabs.includes("themeIcon"),
  );
  check("4 articles par thème (grille)", tabs.includes("lg:grid-cols-4"));

  const card = readSource("src/components/ThemeCard.tsx");
  check(
    "ThemeCard : badge, nom, description, compteur, lien",
    card.includes("themeBadgeStyle") &&
      card.includes("themeIcon") &&
      card.includes("articleCount") &&
      card.includes("href={`/theme/${theme.slug}`}"),
  );
  check(
    "SectionBlock : libellé de lien personnalisable",
    readSource("src/components/SectionBlock.tsx").includes("linkLabel"),
  );

  /* ------------------------------------------------------- 2) page /themes */
  section("Page /themes");
  const themesPage = readSource("src/app/themes/page.tsx");
  check("page créée (Server Component)", themesPage.includes("export default async function ThemesIndexPage"));
  check(
    "thèmes actifs avec comptage des articles publiés",
    themesPage.includes("where: { active: true }") &&
      themesPage.includes('_count: { select: { articles: { where: { status: "PUBLISHED" } } } }'),
  );
  check("grille de ThemeCard", themesPage.includes("<ThemeCard"));
  check(
    "métadonnées « Tous les thèmes »",
    themesPage.includes('title: "Tous les thèmes"'),
  );

  /* ------------------------------------------------------ 3) page d'accueil */
  section("Page d'accueil");
  const home = readSource("src/app/page.tsx");
  check("bloc d'onglets importé et rendu", home.includes("<ThemeTabs themes={themeTabs} />"));
  check(
    "lien « Tous les thèmes » sous le bloc",
    home.includes('href="/themes"') && home.includes("Tous les thèmes"),
  );
  check(
    "bloc Mercato basé sur le thème éditorial",
    home.includes('t.slug = \'mercato\'') && home.includes('"_ArticleToTheme"'),
  );
  check(
    "bloc Mercato : lien vers /theme/mercato",
    home.includes('href="/theme/mercato"') && home.includes('linkLabel="Voir tout le Mercato"'),
  );
  check(
    "bloc Analyses : format ANALYSIS + lien /theme/tactique",
    home.includes("a.format='ANALYSIS'") &&
      home.includes('href="/theme/tactique"') &&
      home.includes('linkLabel="Voir toutes les analyses"'),
  );
  check(
    "onglets pré-chargés en une seule requête (ROW_NUMBER par thème)",
    home.includes("ROW_NUMBER() OVER (PARTITION BY t.id") && home.includes("rn <= 4"),
  );
  check(
    "un thème sans article reste listé (LEFT JOIN)",
    /FROM "Theme" t\s*LEFT JOIN "_ArticleToTheme"/.test(home),
  );
  check(
    "l'ancien filtre par catégorie a disparu",
    !home.includes("CASE WHEN EXISTS(SELECT 1 FROM \"Category\" WHERE slug='mercato')"),
  );
  check(
    "bloc d'onglets placé juste après le hero",
    home.indexOf("<ThemeTabs themes={themeTabs} />") < home.indexOf('id="mercato"'),
  );

  /* ------------------------------------------------------- 4) rendu réel */
  section("Rendu réel");
  const db = new Database();
  const author = db.prepare("SELECT id FROM Author ORDER BY createdAt LIMIT 1").get();
  // Catégorie volontairement NON football : c'est la preuve que le bloc suit le
  // thème et non plus la catégorie sportive.
  const category = db.prepare("SELECT id, name FROM Category WHERE slug <> 'football' ORDER BY name LIMIT 1").get();
  const mercato = db.prepare("SELECT id FROM Theme WHERE slug = 'mercato'").get();
  const suffix = Date.now().toString(36);
  const articleId = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const articleSlug = `test-wp16d-mercato-${suffix}`;
  const inactiveThemeId = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const inactiveSlug = `test-wp16d-inactif-${suffix}`;

  try {
    db.prepare(
      `INSERT INTO Article (id, title, slug, content, excerpt, status, format, "publishedAt", "authorId", "categoryId", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', 'NEWS', CURRENT_TIMESTAMP, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(articleId, "Article de test WP16d", articleSlug, "Contenu.", "Extrait.", author.id, category.id);
    db.prepare('INSERT INTO "_ArticleToTheme" ("A", "B") VALUES (?, ?)').run(articleId, mercato.id);

    db.prepare(
      `INSERT INTO Theme (id, name, slug, description, color, icon, active, "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(inactiveThemeId, "Thème inactif WP16d", inactiveSlug, "Désactivé.", "#888888", "Tag");

    // Requête du bloc Mercato, telle qu'écrite dans la page d'accueil.
    const mercatoByTheme = db
      .prepare(
        `SELECT a.slug FROM "Article" a
         WHERE a.status = 'PUBLISHED' AND a."publishedAt" <= NOW()
           AND EXISTS (SELECT 1 FROM "_ArticleToTheme" j JOIN "Theme" t ON t.id = j."B"
                       WHERE j."A" = a.id AND t.slug = 'mercato')
         ORDER BY a."publishedAt" DESC LIMIT 5`,
      )
      .all()
      .map((row) => row.slug);
    const mercatoByCategory = db
      .prepare(
        `SELECT a.slug FROM "Article" a JOIN "Category" c ON c.id = a."categoryId"
         WHERE a.status = 'PUBLISHED' AND a."publishedAt" <= NOW() AND c.slug = 'football'
         ORDER BY a."publishedAt" DESC LIMIT 5`,
      )
      .all()
      .map((row) => row.slug);

    check("catégorie de test non football", category.name !== "Football", category.name);
    check(
      "le bloc Mercato sélectionne l'article par son thème",
      mercatoByTheme.includes(articleSlug),
      `${mercatoByTheme.length} article(s)`,
    );
    check(
      "l'ancien filtre par catégorie l'aurait exclu",
      !mercatoByCategory.includes(articleSlug),
      `${mercatoByCategory.length} article(s) football`,
    );

    /* HTML : accueil et page des thèmes. */
    const homePage = await get("/");
    const cleanHome = stripComments(homePage.body);
    check("accueil rendu", homePage.status === 200, `status=${homePage.status}`);
    check("accueil : bloc d'onglets", cleanHome.includes('role="tablist"') && cleanHome.includes("Thèmes"));
    check(
      "accueil : les 8 thèmes actifs en onglets",
      ["Mercato", "Tactique", "Interviews", "Compétitions", "Blessures", "Polémiques", "Power Ranking", "Opinion"].every((name) =>
        cleanHome.includes(name),
      ),
    );
    check(
      "accueil : lien « Tous les thèmes »",
      cleanHome.includes('href="/themes"') && cleanHome.includes("Tous les thèmes"),
    );
    check(
      "accueil : bloc Mercato vers /theme/mercato",
      cleanHome.includes('href="/theme/mercato"') && cleanHome.includes("Voir tout le Mercato"),
    );
    check(
      "accueil : bloc Analyses vers /theme/tactique",
      cleanHome.includes('href="/theme/tactique"') && cleanHome.includes("Voir toutes les analyses"),
    );
    check(
      "accueil : panneau d'onglet unique dans le HTML",
      (cleanHome.match(/role="tabpanel"/g) ?? []).length === 1,
    );
    check(
      "accueil : plus de lien ?rubrique=mercato",
      !cleanHome.includes("rubrique=mercato"),
    );

    const themesPageHtml = await get("/themes");
    const cleanThemes = stripComments(themesPageHtml.body);
    check("page /themes rendue", themesPageHtml.status === 200, `status=${themesPageHtml.status}`);
    check("titre SEO « Tous les thèmes | PromptSport »", /<title>Tous les thèmes \| PromptSport<\/title>/.test(themesPageHtml.body));
    check(
      "les 8 thèmes actifs sont listés",
      ["Mercato", "Tactique", "Interviews", "Compétitions", "Blessures", "Polémiques", "Power Ranking", "Opinion"].every((name) =>
        cleanThemes.includes(name),
      ),
    );
    check("le thème désactivé n'est pas listé", !cleanThemes.includes('href="/theme/transferts"'));
    check("comptage affiché", /article/.test(cleanThemes));
    check("aucun thème inactif", !cleanThemes.includes("Thème inactif WP16d"));
    check(
      "chaque carte mène au thème",
      (cleanThemes.match(/href="\/theme\//g) ?? []).length >= 5,
    );

    // Information : la page d'accueil est mise en cache 60 s, l'article de test
    // peut donc n'apparaître qu'après expiration.
    const homeAgain = stripComments((await get("/")).body);
    console.log(
      `   (info) article de test visible sur l'accueil : ${homeAgain.includes("Article de test WP16d") ? "oui" : "pas encore (cache 60 s)"}`,
    );
  } finally {
    db.prepare('DELETE FROM "_ArticleToTheme" WHERE "A" = ?').run(articleId);
    db.prepare("DELETE FROM Article WHERE id = ?").run(articleId);
    db.prepare("DELETE FROM Theme WHERE id = ?").run(inactiveThemeId);
    const leftArticles = db.prepare("SELECT count(*) AS n FROM Article WHERE slug LIKE ?").get("test-wp16d-%");
    const leftThemes = db.prepare("SELECT count(*) AS n FROM Theme WHERE slug LIKE ?").get("test-wp16d-%");
    console.log(`   (nettoyage : ${leftArticles.n} article(s), ${leftThemes.n} thème(s) restant(s))`);
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
