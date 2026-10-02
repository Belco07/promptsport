/**
 * Vérification de la barre de navigation publique et de son état de session.
 * Exécution : node scripts/check-public-nav.cjs
 *
 * Limite assumée : l'état « connecté » de la barre est rendu côté client
 * (fetch de /api/auth/session) pour préserver l'ISR des pages publiques. Le
 * HTML rendu par le serveur contient donc toujours l'emplacement neutre : ce
 * script vérifie la source de données (/api/auth/session) et le fait que la
 * branche « connecté » est bien embarquée dans le bundle client. La
 * confirmation visuelle finale demande un navigateur.
 */
const http = require("node:http");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

function createJar() {
  const store = new Map();
  return {
    absorb(setCookieHeaders) {
      for (const raw of setCookieHeaders ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    has(name) {
      return Boolean(store.get(name));
    },
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

async function login() {
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrfBody = (await request("GET", "/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(
      `Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF renvoyé) : un autre projet l'occupe probablement. Relancez avec PORT=<port de promptsport>.`,
    );
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: {
      csrfToken: csrf,
      email: "admin@example.com",
      password: "admin123",
      callbackUrl: `${ORIGIN}/`,
    },
  });
  return jar;
}

/** Récupère les scripts référencés par une page et cherche un extrait dedans. */
async function bodyContainsInScripts(html, needle) {
  const sources = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const src of [...new Set(sources)]) {
    const chunk = await request("GET", src);
    if (chunk.body.includes(needle)) return src;
  }
  return null;
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  // 1) Visiteur anonyme : état neutre, pas de « Se connecter » figé dans le HTML.
  const home = await request("GET", "/");
  if (!home.body.includes("Mon Site d")) {
    throw new Error(
      `Le port ${PORT} ne sert pas promptsport (page d'accueil inconnue) : un autre projet l'occupe probablement. Relancez avec PORT=<port de promptsport>.`,
    );
  }
  check("GET / -> 200", home.status === 200, `status=${home.status}`);
  check("liens publics présents",
    home.body.includes("Accueil") && home.body.includes("Scores") && home.body.includes("Abonnement"));
  check("état neutre tant que la session n'est pas lue",
    !home.body.includes(">Se connecter<") && !home.body.includes(">Se déconnecter<"),
    home.body.includes(">Se connecter<") ? "« Se connecter » présent dans le HTML serveur" : "emplacement neutre");

  // 2) Source de données anonyme.
  const anonSession = await request("GET", "/api/auth/session");
  const anonUser = JSON.parse(anonSession.body || "{}")?.user ?? null;
  check("session anonyme : aucun utilisateur", anonUser === null, JSON.stringify(anonUser));

  // 3) Source de données connectée.
  const jar = await login();
  check("cookie de session posé", jar.has("authjs.session-token"));
  const session = JSON.parse((await request("GET", "/api/auth/session", { jar })).body || "{}");
  check("session connectée : ADMIN identifié",
    session?.user?.email === "admin@example.com" && session?.user?.role === "ADMIN",
    `${session?.user?.email ?? "?"} / ${session?.user?.role ?? "?"}`);

  // 4) La branche « connecté » est bien embarquée côté client (WP7d : menu utilisateur).
  const withAccountLink = await bodyContainsInScripts(home.body, "Mon compte");
  check("bundle client : entrée de menu « Mon compte »", Boolean(withAccountLink), withAccountLink ?? "introuvable");
  const withLogout = await bodyContainsInScripts(home.body, "Se déconnecter");
  check("bundle client : bouton « Se déconnecter »", Boolean(withLogout), withLogout ?? "introuvable");

  // 5) La page de connexion garde son bouton.
  const loginPage = await request("GET", "/login");
  check("GET /login : bouton « Se connecter »", loginPage.status === 200 && loginPage.body.includes("Se connecter"));

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exit(1);
});
