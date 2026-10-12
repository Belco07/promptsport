/**
 * WP16c — Pages publiques de thèmes.
 *
 * Vérifie la page `/theme/[slug]` (en-tête, liste paginée, filtre par format),
 * les métadonnées SEO, le JSON-LD, le 404 sur thème inexistant ou inactif, la
 * présence des thèmes dans le sitemap, et le rendu réel avec des articles de
 * test (12 par page, filtre FLASH).
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp16c.cjs
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const Database = require("./lib/pg-sync.cjs");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const SITE = `http://${HOST}:${PORT}`;

/** Thèmes actifs après le WP20 (8 sur 9 : « transferts » est désactivé). */
const ACTIVE_THEME_SLUGS = [
  "mercato",
  "tactique",
  "interviews",
  "competitions",
  "blessures",
  "polemiques",
  "power-ranking",
  "opinion",
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
  /* ------------------------------------------------------------- 1) page */
  section("Page /theme/[slug]");
  const pagePath = "src/app/theme/[slug]/page.tsx";
  const page = readSource(pagePath);
  check("page créée", page.includes("export default async function ThemePage"));
  check(
    "thème lu par slug et 404 si absent",
    page.includes("prisma.theme.findUnique({ where: { slug }") && page.includes("notFound()"),
  );
  check(
    "404 aussi pour un thème inactif",
    /theme && theme\.active \? theme : null/.test(page) || /active\s*\?\s*theme\s*:\s*null/.test(page),
  );
  check(
    "articles publiés du thème, plus récents d'abord",
    page.includes('status: "PUBLISHED"') &&
      page.includes("themes: { some: { id: theme.id } }") &&
      page.includes('orderBy: { publishedAt: "desc" }'),
  );
  check(
    "pagination de 12 articles par page",
    page.includes("PAGE_SIZE = 12") && page.includes("skip: (page - 1) * PAGE_SIZE"),
  );
  check(
    "filtre par format validé sur les trois valeurs",
    page.includes('value === "FLASH" || value === "NEWS" || value === "ANALYSIS"'),
  );
  check(
    "métadonnées SEO",
    page.includes("export async function generateMetadata") && page.includes("buildPageMetadata"),
  );
  check("JSON-LD ItemList", page.includes("itemListJsonLd"));
  check(
    "composants utilisés",
    page.includes("<ThemeHeader") && page.includes("<FormatFilter") && page.includes("<ArticleCard"),
  );
  check("page ISR (revalidate 60)", page.includes("export const revalidate = 60"));

  /* -------------------------------------------------------- 2) composants */
  section("Composants");
  const header = readSource("src/components/ThemeHeader.tsx");
  check(
    "ThemeHeader : badge coloré, nom, description, compteur",
    header.includes("themeBadgeStyle") &&
      header.includes("themeIcon") &&
      header.includes("<h1") &&
      header.includes("articleCount"),
  );
  const filter = readSource("src/components/FormatFilter.tsx");
  check(
    "FormatFilter : « Tous » + trois formats",
    filter.includes("Tous") && filter.includes("FLASH") && filter.includes("NEWS") && filter.includes("ANALYSIS"),
  );
  check(
    "filtre actif signalé par aria-current",
    filter.includes('aria-current={activeFormat === format.value ? "page" : undefined}'),
  );
  check(
    "registre d'icônes partagé dans src/lib/themes.ts",
    readSource("src/lib/themes.ts").includes("export function themeIcon") &&
      readSource("src/lib/themes.ts").includes("THEME_ICONS"),
  );

  /* ----------------------------------------------------------- 3) sitemap */
  section("Sitemap");
  const sitemap = readSource("src/app/sitemap.ts");
  check(
    "les thèmes actifs sont déclarés",
    sitemap.includes("prisma.theme.findMany") &&
      sitemap.includes("where: { active: true }") &&
      sitemap.includes("${SITE_URL}/theme/${theme.slug}"),
  );

  /* ---------------------------------------------------- 4) données de test */
  section("Rendu réel");
  const db = new Database();
  const author = db.prepare("SELECT id FROM Author ORDER BY createdAt LIMIT 1").get();
  const category = db.prepare("SELECT id FROM Category ORDER BY name LIMIT 1").get();
  const suffix = Date.now().toString(36);
  const themeSlug = `test-theme-wp16c-${suffix}`;
  const inactiveSlug = `test-theme-inactif-${suffix}`;
  const themeId = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const inactiveId = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
  const createdIds = [];

  try {
    // `active` est un booléen : on l'écrit en littéral SQL (la passerelle
    // synchrone ne convertit pas les booléens JavaScript).
    const insertActiveTheme = db.prepare(
      `INSERT INTO Theme (id, name, slug, description, color, icon, active, "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    const insertInactiveTheme = db.prepare(
      `INSERT INTO Theme (id, name, slug, description, color, icon, active, "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    insertActiveTheme.run(themeId, "Thème de test", themeSlug, "Description du thème de test.", "#3b82f6", "Repeat");
    insertInactiveTheme.run(inactiveId, "Thème inactif", inactiveSlug, "Ce thème est désactivé.", "#999999", "Tag");

    // 13 articles : 2 FLASH, 11 NEWS — de quoi tester la pagination et le filtre.
    // Les dates de publication sont distinctes (sinon l'ordre « desc » est
    // instable entre deux articles publiés dans la même seconde).
    const insertArticle = db.prepare(
      `INSERT INTO Article (id, title, slug, content, excerpt, status, format, "publishedAt", "authorId", "categoryId", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    const base = Date.now();
    for (let index = 1; index <= 13; index += 1) {
      const id = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
      const slug = `${themeSlug}-article-${index}`;
      const format = index <= 2 ? "FLASH" : "NEWS";
      // L'article 13 est le plus récent, l'article 1 le plus ancien.
      const publishedAt = new Date(base + index * 60_000).toISOString();
      insertArticle.run(
        id,
        `Article de test n°${index}`,
        slug,
        "Contenu de test.",
        "Extrait de test.",
        format,
        publishedAt,
        author.id,
        category.id,
      );
      createdIds.push(id);
      db.prepare('INSERT INTO "_ArticleToTheme" ("A", "B") VALUES (?, ?)').run(id, themeId);
    }
    // Un article du thème inactif : sa page ne doit pas l'exposer.
    const inactiveArticleId = `c${randomUUID().replace(/-/g, "").slice(0, 22)}`;
    insertArticle.run(
      inactiveArticleId,
      "Article du thème inactif",
      `${inactiveSlug}-article`,
      "Contenu.",
      "Extrait.",
      "NEWS",
      new Date(base).toISOString(),
      author.id,
      category.id,
    );
    createdIds.push(inactiveArticleId);
    db.prepare('INSERT INTO "_ArticleToTheme" ("A", "B") VALUES (?, ?)').run(inactiveArticleId, inactiveId);

    /* En-tête et liste. */
    const themePage = await get(`/theme/${themeSlug}`);
    // React insère des commentaires entre texte et expressions : on les retire
    // avant les recherches de libellés (« Page 1 sur 2 »).
    const cleanThemePage = themePage.body.replace(/<!--[\s\S]*?-->/g, "");
    const cardCount = (html) => (html.match(/class="[^"]*editorial-card/g) ?? []).length;

    check("page du thème rendue", themePage.status === 200, `status=${themePage.status}`);
    check("nom du thème dans l'en-tête", themePage.body.includes("Thème de test"));
    check("description du thème affichée", themePage.body.includes("Description du thème de test."));
    check("compteur d'articles", /13 article/.test(cleanThemePage));
    check("badge coloré du thème", themePage.body.includes("theme-badge") && themePage.body.includes("#3b82f6"));

    const cards = cardCount(themePage.body);
    check("12 articles affichés sur la première page", cards === 12, `${cards} carte(s)`);
    check(
      "pagination affichée",
      cleanThemePage.includes("Page 1 sur 2") && cleanThemePage.includes("Page suivante"),
    );

    const secondPage = await get(`/theme/${themeSlug}?page=2`);
    const cleanSecondPage = secondPage.body.replace(/<!--[\s\S]*?-->/g, "");
    check("page 2 accessible", secondPage.status === 200, `status=${secondPage.status}`);
    check(
      "page 2 : indicateur et article le plus ancien",
      cleanSecondPage.includes("Page 2 sur 2") && cleanSecondPage.includes("Article de test n°1"),
    );
    check("page 2 : un seul article", cardCount(secondPage.body) === 1, `${cardCount(secondPage.body)} carte(s)`);
    check(
      "ordre : l'article le plus récent est en page 1",
      cleanThemePage.includes("Article de test n°13") && !cleanThemePage.includes("Article de test n°1<"),
    );

    /* Filtre par format. */
    const flash = await get(`/theme/${themeSlug}?format=FLASH`);
    check("filtre FLASH : 2 articles", cardCount(flash.body) === 2, `${cardCount(flash.body)} carte(s)`);
    check("filtre FLASH : actif signalé", flash.body.includes('aria-current="page"'));
    const analysis = await get(`/theme/${themeSlug}?format=ANALYSIS`);
    check(
      "filtre sans résultat : état vide explicite",
      analysis.body.includes("Aucun article de ce format pour ce thème."),
    );

    /* 404. */
    const missing = await get("/theme/theme-qui-nexiste-pas");
    check("thème inexistant : 404", missing.status === 404, `status=${missing.status}`);
    const inactive = await get(`/theme/${inactiveSlug}`);
    check("thème inactif : 404", inactive.status === 404, `status=${inactive.status}`);

    /* Métadonnées et JSON-LD. */
    const title = /<title>([^<]*)<\/title>/.exec(themePage.body)?.[1] ?? "";
    check("titre SEO « [Thème] | PromptSport »", title === "Thème de test | PromptSport", title);
    const description = /<meta name="description" content="([^"]*)"/.exec(themePage.body)?.[1] ?? "";
    check(
      "description SEO issue du thème",
      description.includes("Description du thème de test."),
      description.slice(0, 60),
    );
    check(
      "URL canonique",
      themePage.body.includes(`rel="canonical" href="${SITE}/theme/${themeSlug}"`),
    );
    check("JSON-LD ItemList", themePage.body.includes('"@type":"ItemList"'));
    check("JSON-LD : 12 éléments sur la page 1", (themePage.body.match(/"@type":"ListItem"/g) ?? []).length === 12);

    /* Sitemap. */
    const sitemapXml = await get("/sitemap.xml");
    check("sitemap servi", sitemapXml.status === 200, `status=${sitemapXml.status}`);
    check(
      "sitemap : thèmes actifs présents",
      ACTIVE_THEME_SLUGS.every((slug) => sitemapXml.body.includes(`/theme/${slug}`)),
    );
    check("sitemap : thème désactivé absent", !sitemapXml.body.includes("/theme/transferts"));
  } finally {
    for (const id of createdIds) {
      db.prepare('DELETE FROM "_ArticleToTheme" WHERE "A" = ?').run(id);
      db.prepare("DELETE FROM Article WHERE id = ?").run(id);
    }
    const leftArticles = db.prepare("SELECT count(*) AS n FROM Article WHERE slug LIKE ?").get(`${themeSlug}%`);
    db.prepare("DELETE FROM Theme WHERE id = ?").run(themeId);
    db.prepare("DELETE FROM Theme WHERE id = ?").run(inactiveId);
    const leftThemes = db.prepare("SELECT count(*) AS n FROM Theme WHERE slug LIKE ?").get("test-theme%");
    console.log(`   (articles de test restants : ${leftArticles.n}, thèmes de test restants : ${leftThemes.n})`);
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
