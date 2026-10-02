/**
 * Vérification du WP6a — modèle de données sportives + page admin.
 * Exécution : node scripts/check-wp6a.cjs
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
    form: { csrfToken: csrf, email: "admin@example.com", password: "admin123", callbackUrl: `${ORIGIN}/backoffice` },
  });
  return jar;
}

async function main() {
  const jar = await login();
  check("ADMIN connecté", jar.has("authjs.session-token"));

  // Accès non-admin refusé
  const anon = await request("GET", "/backoffice/sports");
  check("sans session /backoffice/sports -> /login", anon.status === 307 && anon.location === "/login");

  // Page sports — WP12a : /backoffice/sports redirige (307) vers l'onglet
  // compétitions, et chaque section (compétitions / équipes / matchs) est
  // devenue sa propre route : on contrôle chacune d'elles.
  const sportsRedirect = await request("GET", "/backoffice/sports", { jar });
  check(
    "GET /backoffice/sports redirige vers l'onglet compétitions",
    sportsRedirect.status === 307 && sportsRedirect.location === "/backoffice/sports/competitions",
    `status=${sportsRedirect.status} location=${sportsRedirect.location}`,
  );
  const sports = await request("GET", "/backoffice/sports/competitions", { jar });
  const teams = await request("GET", "/backoffice/sports/teams", { jar });
  const matches = await request("GET", "/backoffice/sports/matches", { jar });
  check("GET /backoffice/sports/competitions -> 200", sports.status === 200, `status=${sports.status}`);
  check("section Compétitions présente", sports.body.includes("Compétitions"));
  check("section Équipes présente", teams.status === 200 && teams.body.includes("Équipes"), `status=${teams.status}`);
  check("section Matchs présente", matches.status === 200 && matches.body.includes("Matchs"), `status=${matches.status}`);
  check("compétition de test affichée", sports.body.includes("Ligue 1"));
  check(
    "équipes de test affichées",
    teams.body.includes("Paris Saint-Germain") && teams.body.includes("Olympique de Marseille"),
  );
  check("match de test affiché", matches.body.includes("Terminé") || matches.body.includes("FINISHED"));
  check("lien Sports dans la sidebar", sports.body.includes("Sports"));

  // Tableau de bord : lien sports + nb matchs à venir
  const backoffice = await request("GET", "/backoffice", { jar });
  check("tableau de bord : lien Sports", backoffice.body.includes("/backoffice/sports"));
  check("tableau de bord : nb matchs", backoffice.body.includes("match à venir"));

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
