/**
 * Vérification du WP8a — métadonnées SEO, Open Graph, Twitter Cards et JSON-LD.
 * Exécution : node scripts/check-wp8a.cjs   (PORT=3002 pour ce projet)
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
          length: Number(res.headers["content-length"] ?? 0),
          bytes: Buffer.concat(chunks),
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const unescapeHtml = (value) =>
  (value ?? "")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Compare deux URLs en ignorant la barre oblique finale (Next normalise la racine). */
const sameUrl = (a, b) => String(a ?? "").replace(/\/+$/, "") === String(b ?? "").replace(/\/+$/, "");

/** Contenu d'une balise meta (property ou name). */
function meta(html, key) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*content="([^"]*)"`,
    "i",
  );
  const match = html.match(pattern);
  return match ? unescapeHtml(match[1]) : null;
}

/** Valeur d'un <link rel="...">. */
function link(html, rel) {
  const pattern = new RegExp(`<link[^>]+rel="${rel}"[^>]*href="([^"]*)"`, "i");
  const match = html.match(pattern);
  return match ? unescapeHtml(match[1]) : null;
}

function title(html) {
  const match = html.match(/<title>([^<]*)<\/title>/i);
  return match ? unescapeHtml(match[1]) : null;
}

/** Objets JSON-LD présents dans la page. */
function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks
    .map((block) => {
      try {
        return JSON.parse(block[1]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/* ------------------------------------------------------------------- tests */

async function main() {
  const dbUrl = readFileSync(path.resolve(".env"), "utf8").match(
    /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
  )[1];
  const db = new Database(path.resolve(dbUrl.replace(/^file:(\/\/)?/, "")));

  const article = db
    .prepare("SELECT slug, title FROM Article WHERE status = 'PUBLISHED' AND isPremium = 0 ORDER BY publishedAt DESC LIMIT 1")
    .get();
  const premiumArticle = db
    .prepare("SELECT slug, title FROM Article WHERE status = 'PUBLISHED' AND isPremium = 1 LIMIT 1")
    .get();
  const competition = db.prepare("SELECT slug, name, sport FROM Competition ORDER BY name LIMIT 1").get();
  const match = db
    .prepare("SELECT id, venue, scheduledAt, homeTeamId FROM Match ORDER BY scheduledAt DESC LIMIT 1")
    .get();
  const matchTeams = match
    ? db
        .prepare("SELECT home.name AS home, away.name AS away FROM Match m JOIN Team home ON home.id = m.homeTeamId JOIN Team away ON away.id = m.awayTeamId WHERE m.id = ?")
        .get(match.id)
    : null;
  db.close();

  // 1) Variable d'environnement
  const env = readFileSync(path.resolve(".env"), "utf8");
  check("NEXT_PUBLIC_SITE_URL déclarée dans .env", /NEXT_PUBLIC_SITE_URL\s*=/.test(env));

  // Image Open Graph par défaut, récupérée une fois pour toutes les comparaisons.
  const defaultOg = await get("/og-default.png");

  // 2) Métadonnées globales (source)
  const layout = readFileSync(path.resolve("src/app/layout.tsx"), "utf8");
  check("layout : metadataBase", layout.includes("metadataBase"));
  check("layout : gabarit de titre", layout.includes("%s | "));
  check("layout : openGraph de site", layout.includes("openGraph") && layout.includes("siteName"));
  check("layout : Twitter Card", layout.includes("summary_large_image"));
  check("layout : icônes déclarées", layout.includes("apple-touch-icon.png") && layout.includes("favicon.ico"));

  // 3) Page d'accueil
  const home = await get("/");
  check("accueil : GET / -> 200", home.status === 200, `status=${home.status}`);
  check("accueil : URL canonique", sameUrl(link(home.body, "canonical"), SITE_URL),
    String(link(home.body, "canonical")));
  check("accueil : og:type=website", meta(home.body, "og:type") === "website", String(meta(home.body, "og:type")));
  check("accueil : og:site_name", meta(home.body, "og:site_name") === "PromptSport");
  check("accueil : og:locale=fr_FR", meta(home.body, "og:locale") === "fr_FR");
  check("accueil : og:url", sameUrl(meta(home.body, "og:url"), SITE_URL), String(meta(home.body, "og:url")));
  check("accueil : og:image", String(meta(home.body, "og:image")).startsWith(SITE_URL),
    String(meta(home.body, "og:image")));
  check("accueil : twitter:card", meta(home.body, "twitter:card") === "summary_large_image");
  check("accueil : twitter:creator", meta(home.body, "twitter:creator") === "@moncompte");
  const homeLd = jsonLd(home.body).find((block) => block["@type"] === "Organization");
  check("accueil : JSON-LD Organization", Boolean(homeLd));
  if (homeLd) {
    check("Organization : name/url/logo",
      homeLd.name === "PromptSport" && homeLd.url === `${SITE_URL}/` &&
        typeof homeLd.logo?.url === "string" && Array.isArray(homeLd.sameAs) && homeLd.sameAs.length > 0,
      JSON.stringify({ name: homeLd.name, url: homeLd.url, sameAs: homeLd.sameAs?.length }));
  }

  // 4) Article
  if (article) {
    const page = await get(`/article/${article.slug}`);
    const canonical = link(page.body, "canonical");
    check("article : URL canonique", canonical === `${SITE_URL}/article/${article.slug}`, String(canonical));
    check("article : titre avec gabarit",
      title(page.body) === `${article.title} | PromptSport`, String(title(page.body)));
    check("article : og:type=article", meta(page.body, "og:type") === "article");
    check("article : og:title = titre de l'article", meta(page.body, "og:title") === article.title);
    check("article : article:published_time", Boolean(meta(page.body, "article:published_time")),
      String(meta(page.body, "article:published_time")));
    check("article : article:section", Boolean(meta(page.body, "article:section")),
      String(meta(page.body, "article:section")));
    check("article : og:image", Boolean(meta(page.body, "og:image")), String(meta(page.body, "og:image")));

    const news = jsonLd(page.body).find((block) => block["@type"] === "NewsArticle");
    check("article : JSON-LD NewsArticle", Boolean(news));
    if (news) {
      check("NewsArticle : champs requis",
        news.headline === article.title && Boolean(news.datePublished) && Boolean(news.dateModified) &&
          news.author?.["@type"] === "Person" && news.publisher?.["@type"] === "Organization" &&
          Boolean(news.mainEntityOfPage?.["@id"]) && Array.isArray(news.image),
        JSON.stringify({ headline: news.headline, author: news.author?.name, publisher: news.publisher?.name }));
      check("NewsArticle : aucun corps d'article exposé", !("articleBody" in news));
      check("NewsArticle : description courte", String(news.description ?? "").length <= 200,
        `${String(news.description ?? "").length} caractères`);
    }

    // Image Open Graph dynamique
    const ogImage = await get(`/article/${article.slug}/opengraph-image`);
    check("article : image OG dynamique servie",
      ogImage.status === 200 && ogImage.contentType.includes("image/png") && ogImage.bytes.length > 10000,
      `status=${ogImage.status} ${ogImage.contentType} ${ogImage.bytes.length} octets`);
    check("article : image OG propre à l'article (≠ image par défaut)",
      defaultOg.bytes.length > 0 && !ogImage.bytes.equals(defaultOg.bytes),
      `article=${ogImage.bytes.length} / défaut=${defaultOg.bytes.length}`);

    if (premiumArticle) {
      const premiumPage = await get(`/article/${premiumArticle.slug}`);
      const premiumNews = jsonLd(premiumPage.body).find((block) => block["@type"] === "NewsArticle");
      check("article premium : JSON-LD présent sans contenu réservé",
        Boolean(premiumNews) && !("articleBody" in (premiumNews ?? {})));
    }
  }

  // 5) Scores
  const scores = await get("/scores");
  check("scores : titre", title(scores.body) === "Scores en direct | PromptSport",
    String(title(scores.body)));
  check("scores : URL canonique", link(scores.body, "canonical") === `${SITE_URL}/scores`);
  const itemList = jsonLd(scores.body).find((block) => block["@type"] === "ItemList");
  check("scores : JSON-LD ItemList", Boolean(itemList));
  if (itemList) {
    check("ItemList : éléments et URLs absolues",
      Array.isArray(itemList.itemListElement) && itemList.numberOfItems === itemList.itemListElement.length &&
        itemList.itemListElement.every((item) => String(item.url).startsWith(SITE_URL)),
      `${itemList.numberOfItems} élément(s)`);
  }

  // 6) Compétition
  if (competition) {
    const page = await get(`/competition/${competition.slug}`);
    check("compétition : titre = nom de la compétition",
      title(page.body) === `${competition.name} | PromptSport`, String(title(page.body)));
    check("compétition : URL canonique",
      link(page.body, "canonical") === `${SITE_URL}/competition/${competition.slug}`);
    const org = jsonLd(page.body).find((block) => block["@type"] === "SportsOrganization");
    check("compétition : JSON-LD SportsOrganization",
      Boolean(org) && org.name === competition.name && org.url === `${SITE_URL}/competition/${competition.slug}`,
      JSON.stringify({ name: org?.name, sport: org?.sport }));
  }

  // 7) Match
  if (match && matchTeams) {
    const page = await get(`/match/${match.id}`);
    const expectedTitle = `${matchTeams.home} vs ${matchTeams.away} | PromptSport`;
    check("match : titre « A vs B — compétition »",
      String(title(page.body)).startsWith(`${matchTeams.home} vs ${matchTeams.away} — `),
      String(title(page.body)));
    check("match : titre avec gabarit", title(page.body) === expectedTitle || String(title(page.body)).endsWith(" | PromptSport"),
      expectedTitle);
    check("match : URL canonique", link(page.body, "canonical") === `${SITE_URL}/match/${match.id}`);
    const event = jsonLd(page.body).find((block) => block["@type"] === "SportsEvent");
    check("match : JSON-LD SportsEvent", Boolean(event));
    if (event) {
      check("SportsEvent : date, équipes et compétition",
        Boolean(event.startDate) && event.homeTeam?.name === matchTeams.home &&
          event.awayTeam?.name === matchTeams.away && Array.isArray(event.competitor) &&
          event.competitor.length === 2,
        JSON.stringify({ startDate: event.startDate, competitors: event.competitor?.map((c) => c.name) }));
      if (match.venue) {
        check("SportsEvent : lieu", event.location?.name === match.venue, String(event.location?.name));
      }
    }
  }

  // 8) Abonnement : noindex
  const subscription = await get("/abonnement");
  const robots = meta(subscription.body, "robots");
  check("/abonnement : titre", String(title(subscription.body)).startsWith("Abonnez-vous"),
    String(title(subscription.body)));
  check("/abonnement : URL canonique", link(subscription.body, "canonical") === `${SITE_URL}/abonnement`);
  check("/abonnement : robots noindex,nofollow",
    String(robots).includes("noindex") && String(robots).includes("nofollow"), String(robots));

  // 9) Icônes et image OG par défaut
  const favicon = await get("/favicon.ico");
  check("/favicon.ico servi", favicon.status === 200 && favicon.bytes.length > 100,
    `status=${favicon.status} ${favicon.bytes.length} octets`);
  const appleIcon = await get("/apple-touch-icon.png");
  check("/apple-touch-icon.png servi", appleIcon.status === 200 && appleIcon.contentType.includes("image/png"),
    `${appleIcon.status} ${appleIcon.contentType} ${appleIcon.bytes.length} octets`);
  const icon512 = await get("/icon-512.png");
  check("/icon-512.png servi", icon512.status === 200 && icon512.contentType.includes("image/png"),
    `${icon512.status} ${icon512.contentType}`);
  const pngWidth = defaultOg.bytes.readUInt32BE(16);
  const pngHeight = defaultOg.bytes.readUInt32BE(20);
  check("/og-default.png : image PNG 1200x630",
    defaultOg.status === 200 && defaultOg.contentType.includes("image/png") &&
      pngWidth === 1200 && pngHeight === 630,
    `${defaultOg.status} ${pngWidth}x${pngHeight} ${defaultOg.bytes.length} octets`);

  // 10) Cohérence des titres
  const pages = await Promise.all([
    get("/"),
    get("/scores"),
    article ? get(`/article/${article.slug}`) : null,
    competition ? get(`/competition/${competition.slug}`) : null,
    subscription,
  ]);
  const titles = pages.filter(Boolean).map((page) => title(page.body));
  check("titres distincts d'une page à l'autre", new Set(titles).size === titles.length,
    titles.join(" | "));

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
