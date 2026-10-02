/**
 * Vérification des pages publiques (WP2d).
 * Exécution : node scripts/check-public-pages.cjs
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);

function get(pathname) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: HOST, port: PORT, path: pathname }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

function dbPath() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const contents = readFileSync(path.resolve(".env"), "utf8");
    const m = contents.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    url = m ? m[1] : null;
  }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  const db = new Database(dbPath());

  // --- 1) Accueil
  const home = await get("/");
  check("accueil repond 200", home.status === 200, `status=${home.status}`);
  check(
    "accueil affiche le titre du site",
    home.body.includes("Mon Site d&#x27;Actualités"),
  );

  // Articles publiés en base, triés par date décroissante.
  // (Le schéma utilise `status` depuis le WP2f : cette suite datait de `published`.)
  const published = db
    .prepare(
      `SELECT slug, title, excerpt, publishedAt, categoryId FROM Article WHERE status = 'PUBLISHED' ORDER BY publishedAt DESC`,
    )
    .all();
  const drafts = db
    .prepare(`SELECT slug, title FROM Article WHERE status <> 'PUBLISHED'`)
    .all();

  if (published.length > 0) {
    check(
      "accueil affiche au moins une carte d'article",
      published.some((a) => home.body.includes(a.title)),
    );
    const category = published[0].categoryId
      ? db.prepare("SELECT name FROM Category WHERE id = ?").get(published[0].categoryId)
      : null;
    check(
      "accueil affiche la catégorie (badge)",
      !category || home.body.includes(category.name),
      category ? category.name : "(article sans catégorie)",
    );
  } else {
    check(
      "accueil affiche le message vide",
      home.body.includes("Aucun article publié pour le moment."),
      "(aucun article publié en base)",
    );
  }

  // --- 2) Détail d'un article publié
  if (published.length > 0) {
    // Le contrôle du rendu Markdown a besoin d'un article qui en contient : on
    // prend le premier publié qui comporte une mise en forme, sinon le premier.
    const withMarkup = db
      .prepare(
        `SELECT slug, title FROM Article WHERE status = 'PUBLISHED' AND (content LIKE '%**%' OR content LIKE '%*%') ORDER BY publishedAt DESC LIMIT 1`,
      )
      .get();
    const article = withMarkup ?? published[0];
    const detail = await get(`/article/${article.slug}`);
    check(
      "détail publié répond 200",
      detail.status === 200,
      `status=${detail.status}`,
    );
    check("détail affiche le titre", detail.body.includes(article.title));
    check(
      "détail affiche le lien retour accueil",
      detail.body.includes("Retour à l&#x27;accueil") ||
        detail.body.includes("Retour à l'accueil"),
    );
    // Le contenu Markdown de l'article de référence contient une mise en forme.
    check(
      "détail rend le Markdown (gras)",
      Boolean(withMarkup) && (detail.body.includes("<strong") || detail.body.includes("<em")),
      withMarkup ? `${article.slug} (balise de mise en forme détectée)` : "(aucun article avec mise en forme)",
    );
    // <title> de la page = titre de l'article
    const titleTag = detail.body.match(/<title>(.*?)<\/title>/);
    check(
      "détail <title> = titre de l'article",
      titleTag ? titleTag[1].includes(article.title) : false,
      titleTag ? titleTag[1] : "(aucun <title>)",
    );
  } else {
    console.log("   (aucun article publié en base pour tester le détail)");
  }

  // --- 3) Un brouillon ne doit PAS être accessible
  if (drafts.length > 0) {
    const draft = drafts[0];
    const draftHome = await get("/");
    check(
      "brouillon absent de l'accueil",
      !draftHome.body.includes(draft.title),
      draft.title,
    );
    const draftDetail = await get(`/article/${draft.slug}`);
    check(
      "brouillon retourne 404",
      draftDetail.status === 404,
      `status=${draftDetail.status}`,
    );
  } else {
    console.log("   (aucun brouillon en base pour tester la 404)");
  }

  // --- 4) Slug inexistant -> 404
  //
  // DÉFAUT CONNU, antérieur au WP9 : /article, /competition et /match possèdent
  // un loading.tsx ; la coquille de streaming part avec le statut 200 avant que
  // la page ne puisse appeler notFound(). Le corps est bien celui d'une page
  // « introuvable », mais le statut reste 200 (« soft 404 »), ce qui est
  // pénalisant en référencement. Le corriger suppose de renoncer au squelette de
  // chargement ajouté au WP8c (arbitrage à faire), d'où le maintien de ce
  // contrôle en échec pour que le défaut reste visible.
  const missing = await get("/article/slug-inexistant-xyz");
  check(
    "slug inexistant retourne 404",
    missing.status === 404,
    `status=${missing.status} (défaut connu : soft 404 dû au loading.tsx de la route)`,
  );

  // --- 5) Grille responsive (classes Tailwind)
  check(
    "grille responsive (1/2/3 colonnes)",
    home.body.includes("grid-cols-1") &&
      home.body.includes("sm:grid-cols-2") &&
      home.body.includes("lg:grid-cols-3"),
  );

  db.close();

  const failed = results.filter((r) => !r).length;
  console.log(
    `\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
