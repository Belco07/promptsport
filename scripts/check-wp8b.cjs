/**
 * Vérification du WP8b — sitemap XML, robots.txt et flux RSS.
 * Exécution : node scripts/check-wp8b.cjs   (PORT=3002 pour ce projet)
 *
 * Note : les validateurs externes (validator.w3.org, xml-sitemaps.com) ne
 * peuvent pas atteindre localhost. Le script valide donc la structure sur place :
 * bonne formation XML (balises équilibrées, entités échappées), comptages
 * comparés à la base, URLs canoniques et absence de doublons.
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? `http://${HOST}:${PORT}`).replace(/\/+$/, "");

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          contentType: res.headers["content-type"] ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/**
 * Contrôle de bonne formation XML minimal : balises équilibrées et aucune
 * esperluette non échappée. Suffisant pour détecter une valeur non échappée.
 */
function xmlWellFormed(xml) {
  const withoutDeclarations = xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

  const stack = [];
  for (const match of withoutDeclarations.matchAll(/<(\/?)([A-Za-z_:][\w:.-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== name) return `balise fermante inattendue : </${name}>`;
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) return `balises non fermées : ${stack.join(", ")}`;

  const badAmp = withoutDeclarations.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/);
  if (badAmp) return `esperluette non échappée près de « ${withoutDeclarations.slice(badAmp.index, badAmp.index + 40)} »`;

  return null;
}

const tagValues = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].trim());

/* ------------------------------------------------------------------- tests */

async function main() {
  const dbUrl = readFileSync(path.resolve(".env"), "utf8").match(
    /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
  )[1];
  const db = new Database(path.resolve(dbUrl.replace(/^file:(\/\/)?/, "")));

  const publishedArticles = db
    .prepare("SELECT slug FROM Article WHERE status = 'PUBLISHED' ORDER BY publishedAt DESC")
    .all();
  const draftArticles = db
    .prepare("SELECT slug FROM Article WHERE status <> 'PUBLISHED'")
    .all();
  const competitions = db.prepare("SELECT slug FROM Competition").all();
  const now = Date.now();
  const matchRows = db
    .prepare("SELECT id FROM Match WHERE scheduledAt BETWEEN ? AND ?")
    .all(new Date(now - 30 * 864e5).toISOString(), new Date(now + 30 * 864e5).toISOString());
  const categoryWithArticles = db
    .prepare(
      `SELECT c.slug, c.name, (SELECT COUNT(*) FROM Article a WHERE a.categoryId = c.id AND a.status = 'PUBLISHED') AS total
       FROM Category c ORDER BY total DESC LIMIT 1`,
    )
    .get();
  db.close();

  /* ------------------------------------------------------------ robots.txt */

  const robots = await get("/robots.txt");
  check("GET /robots.txt -> 200", robots.status === 200, `status=${robots.status}`);
  check("robots : type texte", robots.contentType.includes("text/plain"), robots.contentType);
  check("robots : User-agent: *", /User-agent:\s*\*/i.test(robots.body));
  check("robots : Allow: /", /Allow:\s*\//i.test(robots.body));
  for (const rule of [
    "/studio/",
    "/backoffice/",
    "/mon-compte/",
    "/api/",
    "/login",
    "/abonnement/success",
    "/abonnement/cancel",
    "/opengraph-image",
    "/*/opengraph-image",
  ]) {
    check(`robots : Disallow ${rule}`,
      new RegExp(`Disallow:\\s*${rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(robots.body));
  }
  check("robots : sitemap déclaré", robots.body.includes(`Sitemap: ${SITE_URL}/sitemap.xml`),
    (robots.body.match(/Sitemap:.*/) ?? ["?"])[0]);
  check("robots : directive host", robots.body.includes(`Host: ${SITE_URL}`),
    (robots.body.match(/Host:.*/) ?? ["?"])[0]);

  /* ------------------------------------------------------------ sitemap.xml */

  const sitemap = await get("/sitemap.xml");
  check("GET /sitemap.xml -> 200", sitemap.status === 200, `status=${sitemap.status}`);
  check("sitemap : type XML", /xml/.test(sitemap.contentType), sitemap.contentType);
  const urls = tagValues(sitemap.body, "loc");
  check("sitemap : entrées <url><loc>", urls.length > 0, `${urls.length} entrées`);

  const wellFormed = xmlWellFormed(sitemap.body);
  check("sitemap : XML bien formé", wellFormed === null, wellFormed ?? "");

  const urlSet = new Set(urls);
  check("sitemap : aucune URL en double", urlSet.size === urls.length,
    `${urls.length} entrées / ${urlSet.size} uniques`);
  check("sitemap : pas de double slash", !urls.some((url) => /[^:]\/\//.test(url)),
    urls.find((url) => /[^:]\/\//.test(url)) ?? "");
  check("sitemap : URLs absolues", urls.every((url) => url.startsWith(SITE_URL)),
    urls.find((url) => !url.startsWith(SITE_URL)) ?? "");

  check("sitemap : page d'accueil", urlSet.has(SITE_URL), SITE_URL);
  check("sitemap : /scores", urlSet.has(`${SITE_URL}/scores`));
  // /abonnement est en noindex : il ne doit PAS figurer dans le sitemap.
  check("sitemap : /abonnement absent (page noindex)",
    !urlSet.has(`${SITE_URL}/abonnement`),
    urlSet.has(`${SITE_URL}/abonnement`) ? "présent à tort" : "absent");

  const sitemapArticles = urls.filter((url) => url.includes("/article/"));
  check(`sitemap : ${publishedArticles.length} article(s) publié(s)`,
    sitemapArticles.length === publishedArticles.length,
    `${sitemapArticles.length} dans le sitemap`);
  check("sitemap : tous les articles publiés présents",
    publishedArticles.every((article) => urlSet.has(`${SITE_URL}/article/${article.slug}`)));

  const sitemapCompetitions = urls.filter((url) => url.includes("/competition/"));
  check(`sitemap : ${competitions.length} compétition(s)`,
    sitemapCompetitions.length === competitions.length, `${sitemapCompetitions.length} dans le sitemap`);

  const sitemapMatches = urls.filter((url) => url.includes("/match/"));
  check(`sitemap : ${matchRows.length} match(s) dans la fenêtre ±30 jours`,
    sitemapMatches.length === matchRows.length, `${sitemapMatches.length} dans le sitemap`);

  const forbidden = urls.filter((url) =>
    ["/studio", "/backoffice", "/mon-compte", "/login", "/abonnement/success", "/abonnement/cancel"].some(
      (blocked) => url.includes(blocked),
    ),
  );
  check("sitemap : aucune page technique", forbidden.length === 0, forbidden.join(", "));

  const draftSlugs = draftArticles.map((article) => article.slug);
  check("sitemap : aucun article non publié",
    !draftSlugs.some((slug) => urlSet.has(`${SITE_URL}/article/${slug}`)),
    `${draftSlugs.length} article(s) non publié(s) en base`);

  check("sitemap : priorités et fréquences",
    sitemap.body.includes("<priority>1</priority>") && sitemap.body.includes("<changefreq>daily</changefreq>") &&
      sitemap.body.includes("<changefreq>hourly</changefreq>") && sitemap.body.includes("<lastmod>"),
    "priority 1 / daily / hourly / lastmod");

  /* ----------------------------------------------------------------- rss.xml */

  const rss = await get("/rss.xml");
  check("GET /rss.xml -> 200", rss.status === 200, `status=${rss.status}`);
  check("rss : type de contenu", /application\/rss\+xml/.test(rss.contentType), rss.contentType);
  check("rss : déclaration XML", rss.body.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  check("rss : racine RSS 2.0 avec atom",
    rss.body.includes('<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">'));

  const rssWellFormed = xmlWellFormed(rss.body);
  check("rss : XML bien formé", rssWellFormed === null, rssWellFormed ?? "");

  for (const [label, tag] of [
    ["titre du canal", "title"],
    ["lien du canal", "link"],
    ["description du canal", "description"],
    ["langue", "language"],
    ["lastBuildDate", "lastBuildDate"],
  ]) {
    check(`rss : ${label}`, tagValues(rss.body, tag).length > 0);
  }
  check("rss : langue fr-FR", rss.body.includes("<language>fr-FR</language>"));
  check("rss : auto-référence atom:link",
    rss.body.includes(`<atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml"`));

  const items = [...rss.body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const expectedItems = Math.min(50, publishedArticles.length);
  check(`rss : ${expectedItems} item(s) attendu(s)`, items.length === expectedItems,
    `${items.length} item(s)`);
  check("rss : chaque item complet",
    items.every((item) =>
      ["title", "link", "guid", "description", "pubDate"].every((tag) =>
        new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`).test(item),
      ),
    ));
  check("rss : guid = URL canonique de l'article",
    items.every((item) => {
      const link = tagValues(item, "link")[0];
      const guid = tagValues(item, "guid")[0];
      return link === guid && link.startsWith(`${SITE_URL}/article/`);
    }));
  check("rss : catégories présentes", items.some((item) => /<category>/.test(item)));
  const pubDates = items.map((item) => tagValues(item, "pubDate")[0]);
  check("rss : pubDate au format RFC 822",
    pubDates.every((value) => !Number.isNaN(Date.parse(value)) && /GMT|[+-]\d{4}$/.test(value)),
    pubDates[0] ?? "");
  check("rss : items triés du plus récent au plus ancien",
    pubDates.every((value, index) => index === 0 || Date.parse(pubDates[index - 1]) >= Date.parse(value)));

  /* ------------------------------------------------------- rss par catégorie */

  if (categoryWithArticles) {
    const categoryFeed = await get(`/rss/${categoryWithArticles.slug}`);
    check(`GET /rss/${categoryWithArticles.slug} -> 200`, categoryFeed.status === 200,
      `status=${categoryFeed.status}`);
    const categoryItems = [...categoryFeed.body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    check(`rss catégorie « ${categoryWithArticles.name} » : ${categoryWithArticles.total} article(s)`,
      categoryItems.length === Math.min(50, categoryWithArticles.total),
      `${categoryItems.length} item(s)`);
    check("rss catégorie : filtre appliqué (catégorie unique)",
      categoryItems.every((item) => tagValues(item, "category")[0] === categoryWithArticles.name));
    check("rss catégorie : auto-référence correcte",
      categoryFeed.body.includes(`href="${SITE_URL}/rss/${categoryWithArticles.slug}"`));
  }

  const missingCategory = await get("/rss/categorie-inexistante-wp8b");
  check("GET /rss/catégorie inexistante -> 404", missingCategory.status === 404,
    `status=${missingCategory.status}`);

  /* ------------------------------------------- découverte et footer public */

  const home = await get("/");
  const homeHead = (home.body.match(/<head>[\s\S]*?<\/head>/) ?? [""])[0];
  check("découverte RSS : <link rel=alternate> dans le <head>",
    /<link[^>]+rel="alternate"[^>]+type="application\/rss\+xml"[^>]+href="\/rss\.xml"/.test(homeHead),
    (homeHead.match(/<link[^>]+application\/rss\+xml[^>]*>/) ?? ["absent"])[0]);
  check("découverte RSS : titre du flux", homeHead.includes('title="Flux RSS"'));

  for (const [label, urlPath] of [
    ["accueil", "/"],
    ["scores", "/scores"],
    ["article", publishedArticles[0] ? `/article/${publishedArticles[0].slug}` : null],
    ["abonnement", "/abonnement"],
  ]) {
    if (!urlPath) continue;
    const page = await get(urlPath);
    check(`footer : lien RSS visible sur ${label}`,
      page.body.includes('href="/rss.xml"') && page.body.includes("Flux RSS"));
  }
  if (competitions[0]) {
    const page = await get(`/competition/${competitions[0].slug}`);
    check("footer : lien RSS visible sur une compétition", page.body.includes('href="/rss.xml"'));
  }
  if (matchRows[0]) {
    const page = await get(`/match/${matchRows[0].id}`);
    check("footer : lien RSS visible sur un match", page.body.includes('href="/rss.xml"'));
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
