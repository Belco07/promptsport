/**
 * Vérification du WP4 — séparation Studio / Backoffice.
 * Exécution : node scripts/check-wp4.cjs
 */
const http = require("node:http");

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
  // 1) /login public
  const loginPage = await request("GET", "/login");
  check("login répond 200", loginPage.status === 200, `status=${loginPage.status}`);
  check("login contient le formulaire", loginPage.body.includes('name="email"') && loginPage.body.includes('name="password"'));

  // 2) Accès sans session
  for (const path of ["/studio", "/studio/articles", "/backoffice"]) {
    const r = await request("GET", path);
    check(
      `${path} sans session -> /login`,
      r.status === 307 && r.location === "/login",
      `status=${r.status} location=${r.location}`,
    );
  }

  // 3) /admin -> 404
  const admin = await request("GET", "/admin");
  check("/admin renvoie 404", admin.status === 404, `status=${admin.status}`);
  const adminArticles = await request("GET", "/admin/articles");
  check("/admin/articles renvoie 404", adminArticles.status === 404, `status=${adminArticles.status}`);

  // 4) Connexion -> /studio
  const jar = await login();
  check("session établie", jar.has("authjs.session-token"));

  const studio = await request("GET", "/studio", { jar });
  check("GET /studio -> 200", studio.status === 200, `status=${studio.status}`);
  check(
    "studio affiche « Bienvenue dans la rédaction »",
    studio.body.includes("Bienvenue dans la rédaction"),
  );
  check(
    "sidebar studio : liens attendus",
    ["Tableau de bord", "Articles", "Catégories", "Voir le site", "Se déconnecter"].every((l) => studio.body.includes(l)),
  );

  // 5) Articles
  const articles = await request("GET", "/studio/articles", { jar });
  check("GET /studio/articles -> 200", articles.status === 200, `status=${articles.status}`);
  check("liste articles : bouton Nouvel article", articles.body.includes("Nouvel article"));
  check("liste articles : badges de statut", /Brouillon|En revue|Publié|Archivé/.test(articles.body));

  // 6) Catégories
  const categories = await request("GET", "/studio/categories", { jar });
  check("GET /studio/categories -> 200", categories.status === 200, `status=${categories.status}`);
  check("categories : bouton Nouvelle catégorie", categories.body.includes("Nouvelle catégorie"));
  check("categories : liste des catégories présentes", /Football|Tennis|Rugby|Basket/.test(categories.body));

  // 7) Backoffice
  const backoffice = await request("GET", "/backoffice", { jar });
  check("GET /backoffice -> 200", backoffice.status === 200, `status=${backoffice.status}`);
  check(
    "backoffice affiche « Bienvenue dans le backoffice »",
    backoffice.body.includes("Bienvenue dans le backoffice"),
  );
  check(
    "sidebar backoffice : placeholders désactivés",
    ["Utilisateurs", "Rôles", "Paramètres"].every((l) => backoffice.body.includes(l)),
  );

  // 8) Déconnexion
  const csrf2 = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  const signout = await request("POST", "/api/auth/signout", {
    jar,
    form: { csrfToken: csrf2, callbackUrl: `${ORIGIN}/login` },
  });
  check("déconnexion -> /login", signout.status === 302 && signout.location === `${ORIGIN}/login`);

  const after = await request("GET", "/studio");
  check("après déconnexion /studio -> /login", after.status === 307 && after.location === "/login");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
