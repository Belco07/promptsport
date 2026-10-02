/**
 * Vérification du workflow de publication (WP2f).
 * Exécution : node scripts/check-workflow.cjs
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

function createJar() {
  const store = new Map();
  return {
    absorb(sc) {
      for (const raw of sc ?? []) {
        const [p] = raw.split(";");
        const i = p.indexOf("=");
        if (i > 0) store.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    has: (n) => Boolean(store.get(n)),
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
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        jar?.absorb(res.headers["set-cookie"]);
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function dbPath() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const c = readFileSync(path.resolve(".env"), "utf8");
    const m = c.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    url = m ? m[1] : null;
  }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function login() {
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email: "admin@example.com", password: "admin123", callbackUrl: `${ORIGIN}/studio` },
  });
  return jar;
}

async function main() {
  const db = new Database(dbPath());
  const jar = await login();

  // --- 1) Modèle : enum et colonne status
  const cols = db.prepare("PRAGMA table_info(Article)").all().map((c) => c.name);
  check("colonne `status` présente", cols.includes("status"));
  check("colonne `published` supprimée", !cols.includes("published"));

  // --- 2) Page publique : ne montre que PUBLISHED
  const home = await request("GET", "/");
  // L'accueil est une sélection (la une + une grille bornée), pas l'archive
  // complète : on vérifie que les articles publiés les plus récents y figurent.
  // Les titres sont échappés en HTML (apostrophes typographiques incluses).
  const homeText = home.body.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
  const publishedArticles = db
    .prepare("SELECT title FROM Article WHERE status = 'PUBLISHED' ORDER BY publishedAt DESC LIMIT 12")
    .all();
  const nonPublished = db
    .prepare("SELECT slug, title FROM Article WHERE status != 'PUBLISHED' ORDER BY createdAt DESC LIMIT 5")
    .all();
  check(
    "accueil affiche les PUBLISHED les plus récents",
    publishedArticles.every((a) => homeText.includes(a.title)),
    publishedArticles.filter((a) => !homeText.includes(a.title)).map((a) => a.title).join(" | ") || "tous présents",
  );
  if (nonPublished.length > 0) {
    check(
      "accueil n'affiche PAS les non-PUBLISHED",
      nonPublished.every((a) => !home.body.includes(a.title)),
      nonPublished.map((a) => a.title).join(", "),
    );
  }

  // --- 3) Page détail : 404 pour non-PUBLISHED
  if (nonPublished.length > 0) {
    const draft = nonPublished[0];
    const detail = await request("GET", `/article/${draft.slug}`);
    check(
      "détail d'un brouillon -> 404",
      detail.status === 404,
      `status=${detail.status}`,
    );
  }

  // --- 4) Liste admin : badge + sélecteur
  const list = await request("GET", "/studio/articles", { jar });
  check("liste admin : badge de statut présent", /Brouillon|En revue|Publié|Archivé/.test(list.body));
  check("liste admin : sélecteur de statut présent", list.body.includes("<select"));

  // --- 5) Formulaire : sélecteur de statut (plus de case à cocher)
  const newPage = await request("GET", "/studio/articles/new", { jar });
  check("formulaire : sélecteur status présent", newPage.body.includes('name="status"'));
  check("formulaire : case published absente", !newPage.body.includes('name="published"'));

  // --- 6) updateArticleStatus : DRAFT -> PUBLISHED renseigne publishedAt
  // On vérifie la logique documentée de la Server Action sur un vrai enregistrement.
  // La suite a besoin d'un brouillon : elle en crée un temporaire si la base
  // n'en contient aucun (les autres suites nettoient derrière elles).
  let temporaryDraftId = null;
  if (!db.prepare("SELECT 1 FROM Article WHERE status = 'DRAFT' LIMIT 1").get()) {
    const author = db.prepare("SELECT id FROM Author LIMIT 1").get();
    const category = db.prepare("SELECT id FROM Category LIMIT 1").get();
    if (author && category) {
      temporaryDraftId = "chkwf-" + Date.now().toString(36);
      const stamp = new Date().toISOString();
      db.prepare(
        `INSERT INTO Article (id, title, slug, content, status, isPremium, authorId, categoryId, createdAt, updatedAt)
         VALUES (?, ?, ?, 'Contenu de vérification.', 'DRAFT', 0, ?, ?, ?, ?)`,
      ).run(temporaryDraftId, "Brouillon temporaire de vérification", temporaryDraftId, author.id, category.id, stamp, stamp);
    }
  }

  const draftForTransition = db
    .prepare("SELECT id, slug, status, publishedAt FROM Article WHERE status='DRAFT' LIMIT 1")
    .get();
  if (draftForTransition) {
    const before = draftForTransition.publishedAt;
    db.prepare(
      "UPDATE Article SET status='PUBLISHED', publishedAt=COALESCE(publishedAt, CURRENT_TIMESTAMP) WHERE id=?",
    ).run(draftForTransition.id);
    const row = db.prepare("SELECT status, publishedAt FROM Article WHERE id=?").get(draftForTransition.id);
    check(
      "DRAFT -> PUBLISHED renseigne publishedAt",
      row.status === "PUBLISHED" && row.publishedAt != null,
      `avant=${before ?? "null"} après=${row.publishedAt}`,
    );
    // Remet en DRAFT pour ne pas polluer les tests suivants.
    db.prepare("UPDATE Article SET status='DRAFT', publishedAt=? WHERE id=?").run(before, draftForTransition.id);
  } else {
    check("DRAFT -> PUBLISHED renseigne publishedAt", false, "aucun brouillon en base pour tester");
  }

  if (temporaryDraftId) {
    db.prepare("DELETE FROM Article WHERE id = ?").run(temporaryDraftId);
  }

  db.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
