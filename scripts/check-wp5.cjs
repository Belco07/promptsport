/**
 * Vérification du WP5 — rôles et permissions.
 * Exécution : node scripts/check-wp5.cjs
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

// Accès direct à la base : la suite crée un brouillon temporaire pour vérifier
// les statuts proposés à un journaliste, puis le supprime.
const dbUrl = readFileSync(path.resolve(".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(dbUrl.replace(/^file:(\/\/)?/, "")));

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

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function login(email, password) {
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  const res = await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: {
      csrfToken: csrf,
      email,
      password,
      callbackUrl: `${ORIGIN}/studio`,
    },
  });
  // Le callback renvoie 302 avec la redirection décidée par le code (le callbackUrl
  // n'est pas nécessairement suivi, mais l'important est le cookie de session).
  return { jar, status: res.status, location: res.location };
}

async function main() {
  // 1) ADMIN : redirection après connexion -> /backoffice
  const admin = await login("admin@example.com", "admin123");
  check("ADMIN connecté (cookie)", admin.jar.has("authjs.session-token"));
  const adminBackoffice = await request("GET", "/backoffice", { jar: admin.jar });
  check("ADMIN accède au backoffice", adminBackoffice.status === 200, `status=${adminBackoffice.status}`);
  const adminStudio = await request("GET", "/studio", { jar: admin.jar });
  check("ADMIN accède au studio", adminStudio.status === 200, `status=${adminStudio.status}`);
  const usersPage = await request("GET", "/backoffice/users", { jar: admin.jar });
  check("ADMIN accède à /backoffice/users", usersPage.status === 200, `status=${usersPage.status}`);
  check("liste utilisateurs affiche les rôles", /Administrateur|Éditeur|Journaliste/.test(usersPage.body));

  // 2) JOURNALIST : redirection -> /studio, pas de backoffice
  const journalist = await login("journalist@example.com", "password123");
  check("JOURNALIST connecté", journalist.jar.has("authjs.session-token"));
  const jourBackoffice = await request("GET", "/backoffice", { jar: journalist.jar });
  check(
    "JOURNALIST -> /backoffice redirigé vers /studio",
    jourBackoffice.status === 307 && jourBackoffice.location === "/studio",
    `status=${jourBackoffice.status} location=${jourBackoffice.location}`,
  );
  const jourStudio = await request("GET", "/studio", { jar: journalist.jar });
  check("JOURNALIST accède au studio", jourStudio.status === 200, `status=${jourStudio.status}`);
  // Le sélecteur de statut n'apparaît que sur les articles que l'utilisateur
  // peut traiter (WP11) : on crée donc un brouillon appartenant au journaliste
  // pour vérifier les statuts qui lui sont proposés.
  const journalistRow = db.prepare("SELECT id FROM Author WHERE email = ?").get("journalist@example.com");
  const categoryRow = db.prepare("SELECT id FROM Category LIMIT 1").get();
  const draftId = `chkwp5-${Date.now().toString(36)}`;
  let temporaryDraft = false;
  if (journalistRow && categoryRow) {
    const stamp = new Date().toISOString();
    db.prepare(
      `INSERT INTO Article (id, title, slug, content, status, isPremium, authorId, categoryId, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Contenu de vérification.', 'DRAFT', 0, ?, ?, ?, ?)`,
    ).run(draftId, "Brouillon de vérification WP5", draftId, journalistRow.id, categoryRow.id, stamp, stamp);
    temporaryDraft = true;
  }

  const jourArticles = await request("GET", "/studio/articles", { jar: journalist.jar });
  check(
    "JOURNALIST ne voit pas l'option Publié",
    jourArticles.body.includes("Brouillon") &&
      jourArticles.body.includes("En revue") &&
      !jourArticles.body.includes('value="PUBLISHED"'),
    "PUBLISHED masqué",
  );

  if (temporaryDraft) {
    db.prepare("DELETE FROM Article WHERE id = ?").run(draftId);
  }

  // 3) EDITOR : accès studio + peut publier
  const editor = await login("editor@example.com", "password123");
  check("EDITOR connecté", editor.jar.has("authjs.session-token"));
  const editorBackoffice = await request("GET", "/backoffice", { jar: editor.jar });
  check(
    "EDITOR -> /backoffice redirigé vers /studio",
    editorBackoffice.status === 307 && editorBackoffice.location === "/studio",
    `status=${editorBackoffice.status} location=${editorBackoffice.location}`,
  );
  const editorArticles = await request("GET", "/studio/articles", { jar: editor.jar });
  check(
    "EDITOR voit l'option Publié",
    editorArticles.body.includes('value="PUBLISHED"'),
  );

  // 4) Sans session
  const anonStudio = await request("GET", "/studio");
  check("sans session /studio -> /login", anonStudio.status === 307 && anonStudio.location === "/login");
  const anonBackoffice = await request("GET", "/backoffice");
  check("sans session /backoffice -> /login", anonBackoffice.status === 307 && anonBackoffice.location === "/login");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
