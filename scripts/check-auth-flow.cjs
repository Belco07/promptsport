/**
 * Vérification du parcours d'authentification WP2b.
 * Exécution : node scripts/check-auth-flow.cjs
 *
 * Implémentation volontairement sans dépendance ni processus externe :
 *  - node:http avec redirections manuelles (undici/fetch suit les 302 et
 *    masque le Set-Cookie) ;
 *  - petit bocal à cookies maison, car le fetch de Node n'en a pas et ne
 *    rejoue donc pas le cookie CSRF exigé par Auth.js ;
 *  - aucun spawn de processus (interdit par le sandbox de cet environnement).
 */
const http = require("node:http");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

/** Bocal à cookies minimal. */
function createJar() {
  const store = new Map();
  return {
    absorb(setCookieHeaders) {
      for (const raw of setCookieHeaders ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) {
          store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    has(name) {
      const value = store.get(name);
      return Boolean(value) && value.length > 0;
    },
    size: () => store.size,
  };
}

function request(method, urlPath, { jar, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = {};
  if (jar && jar.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          jar?.absorb(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            setCookie: res.headers["set-cookie"] ?? [],
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  const jar = createJar();

  // 1) /backoffice sans session
  const anon = await request("GET", "/backoffice");
  check(
    "GET /backoffice sans session redirige vers /login",
    anon.status === 307 && anon.location === "/login",
    `status=${anon.status} location=${anon.location}`,
  );

  // 2) formulaire de connexion
  const loginPage = await request("GET", "/login", { jar });
  check("formulaire : champ email", loginPage.body.includes('name="email"'));
  check("formulaire : champ mot de passe", loginPage.body.includes('name="password"'));
  check("formulaire : bouton de connexion", loginPage.body.includes("Se connecter"));

  // 3) connexion
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  check("jeton CSRF obtenu", Boolean(csrf));

  const login = await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: {
      csrfToken: csrf,
      email: "admin@example.com",
      password: "admin123",
      callbackUrl: `${ORIGIN}/backoffice`,
    },
  });
  check(
    "POST credentials -> 302 vers /backoffice",
    login.status === 302 && login.location === `${ORIGIN}/backoffice`,
    `status=${login.status} location=${login.location}`,
  );
  check(
    "cookie de session emis",
    jar.has("authjs.session-token"),
    `cookies=${jar.size()}`,
  );

  // 4) session
  const sessionRaw = (await request("GET", "/api/auth/session", { jar })).body;
  check(
    "session expose l'auteur connecte",
    /admin@example\.com/.test(sessionRaw) && /Admin Test/.test(sessionRaw),
    sessionRaw.trim(),
  );

  // 5) page /backoffice protegee
  const admin = await request("GET", "/backoffice", { jar });
  writeFileSync(path.resolve("scripts/out-backoffice.html"), admin.body, "utf8");
  const h1Match = admin.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  // React insère des séparateurs « <!-- --> » entre nSuds texte : on les retire
  // avant de comparer, sinon « Bienvenue <!-- -->Admin Test » ferait échouer le test.
  const h1 = h1Match
    ? h1Match[1]
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/&#x27;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
    : "(pas de h1)";
  check("GET /backoffice avec session repond 200", admin.status === 200, `status=${admin.status}`);
  // WP12a : le tableau de bord historique /admin a été remplacé par /backoffice
  // (WP5) ; le parcours contrôlé est le même, seule la route change. Le titre
  // est « Bienvenue dans le backoffice, <nom> ».
  check("h1 affiche le nom de l'auteur", /Bienvenue[\s\S]*Admin Test/.test(h1), `h1="${h1}"`);
  check("bouton de deconnexion present", admin.body.includes("Se déconnecter"));

  // 6) deconnexion
  const csrf2 = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  const signout = await request("POST", "/api/auth/signout", {
    jar,
    form: { csrfToken: csrf2, callbackUrl: `${ORIGIN}/login` },
  });
  check(
    "deconnexion -> 302 vers /login",
    signout.status === 302 && signout.location === `${ORIGIN}/login`,
    `status=${signout.status} location=${signout.location}`,
  );
  check(
    "cookie de session supprime",
    signout.setCookie.some(
      (c) => c.startsWith("authjs.session-token=;") && /Max-Age=0/.test(c),
    ),
    signout.setCookie.map((c) => c.split(";")[0]).join(" | ") || "(aucun)",
  );

  // 7) /backoffice redevenu inaccessible
  const afterJar = createJar();
  const after = await request("GET", "/backoffice", { jar: afterJar });
  check(
    "GET /backoffice redevient protege (bocal vide)",
    after.status === 307 && after.location === "/login",
    `status=${after.status} location=${after.location}`,
  );

  // 8) mauvais mot de passe
  const badJar = createJar();
  await request("GET", "/login", { jar: badJar });
  const csrf3 = JSON.parse((await request("GET", "/api/auth/csrf", { jar: badJar })).body).csrfToken;
  const bad = await request("POST", "/api/auth/callback/credentials", {
    jar: badJar,
    form: {
      csrfToken: csrf3,
      email: "admin@example.com",
      password: "mauvais-mot-de-passe",
      callbackUrl: `${ORIGIN}/backoffice`,
    },
  });
  check(
    "mot de passe incorrect : redirige avec CredentialsSignin, pas de session",
    /error=CredentialsSignin/.test(bad.location ?? "") &&
      !badJar.has("authjs.session-token"),
    `location=${bad.location}`,
  );

  // 9) email inconnu
  const unknownJar = createJar();
  await request("GET", "/login", { jar: unknownJar });
  const csrf4 = JSON.parse(
    (await request("GET", "/api/auth/csrf", { jar: unknownJar })).body,
  ).csrfToken;
  const unknown = await request("POST", "/api/auth/callback/credentials", {
    jar: unknownJar,
    form: {
      csrfToken: csrf4,
      email: "inconnu@example.com",
      password: "admin123",
      callbackUrl: `${ORIGIN}/backoffice`,
    },
  });
  check(
    "email inconnu : aucune session emise",
    !unknownJar.has("authjs.session-token"),
    `location=${unknown.location}`,
  );

  // 10) WP1 intact
  const home = await request("GET", "/");
  check(
    "WP1 : / repond 200 avec le titre",
    home.status === 200 && home.body.includes("PromptSport"),
    `status=${home.status}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nRESULTAT: ${results.length - failed.length}/${results.length} verifications reussies`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
