/**
 * Vérification du WP6e — synchronisation Football-Data.org.
 * Exécution : node scripts/check-wp6e.cjs
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
    header() { return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "); },
    has: (n) => Boolean(store.get(n)),
  };
}

function request(method, urlPath, { jar, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = {};
  if (jar?.header()) headers.cookie = jar.header();
  if (body) { headers["content-type"] = "application/x-www-form-urlencoded"; headers["content-length"] = Buffer.byteLength(body); }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        jar?.absorb(res.headers["set-cookie"]);
        resolve({ status: res.statusCode, location: res.headers.location, body: Buffer.concat(chunks).toString("utf8") });
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
    jar, form: { csrfToken: csrf, email: "admin@example.com", password: "admin123", callbackUrl: `${ORIGIN}/backoffice` },
  });
  return jar;
}

async function main() {
  const db = new Database(dbPath());

  // 1) .env
  const env = readFileSync(path.resolve(".env"), "utf8");
  check("FOOTBALL_DATA_API_KEY renseignée", /FOOTBALL_DATA_API_KEY="[^"]{10,}"/.test(env));
  check("ancienne clé TheSportsDB retirée", !/SPORTS_API_KEY/.test(env));

  // 2) Données importées
  const competitions = db.prepare("SELECT count(*) n FROM Competition").get().n;
  const teams = db.prepare("SELECT count(*) n FROM Team").get().n;
  const matches = db.prepare("SELECT count(*) n FROM Match").get().n;
  check("6 compétitions importées", competitions === 6, `competitions=${competitions}`);
  check("équipes importées", teams > 100, `equipes=${teams}`);
  check("matchs importés", matches > 500, `matchs=${matches}`);

  // 3) Ligue 1 : 18 équipes engagées
  const l1 = db.prepare("SELECT id FROM Competition WHERE slug='ligue-1'").get();
  check("compétition ligue-1 présente", Boolean(l1));
  const l1Teams = db.prepare(
    "SELECT count(DISTINCT t.id) n FROM Team t JOIN Match m ON (m.homeTeamId=t.id OR m.awayTeamId=t.id) WHERE m.competitionId=?",
  ).get(l1.id).n;
  check("Ligue 1 : 18 équipes", l1Teams === 18, `equipes=${l1Teams}`);

  // 4) Page publique du classement
  const page = await request("GET", "/competition/ligue-1");
  check("GET /competition/ligue-1 -> 200", page.status === 200, `status=${page.status}`);
  // Le tableau de classement est streamé en plusieurs segments (tables cachées
  // injectées par React) : compter tous les <tr> du document n'a plus de sens.
  // On compte les lignes du classement par leur classe de ligne.
  const standingsRows = (page.body.match(/<tr class="hover:bg-gray-50"/g) ?? []).length;
  check("classement : 18 lignes", standingsRows === 18, `lignes=${standingsRows}`);
  check("titre Ligue 1", page.body.includes("Ligue 1"));

  // 5) /scores
  const scores = await request("GET", "/scores");
  check("GET /scores -> 200", scores.status === 200, `status=${scores.status}`);
  check("sections scores présentes", scores.body.includes("En direct") && scores.body.includes("À venir") && scores.body.includes("Terminés récemment"));

  // 6) Un match est consultable
  const anyMatch = db.prepare("SELECT id FROM Match LIMIT 1").get();
  const matchPage = await request("GET", `/match/${anyMatch.id}`);
  check("GET /match/[id] -> 200", matchPage.status === 200, `status=${matchPage.status}`);

  // 7) Page de synchronisation (admin)
  const jar = await login();
  const syncPage = await request("GET", "/backoffice/sports/sync", { jar });
  check("GET /backoffice/sports/sync -> 200", syncPage.status === 200);
  check("bouton « Tout synchroniser »", syncPage.body.includes("Tout synchroniser"));
  check("section progression", syncPage.body.includes("Progression"));
  check("bouton par compétition", syncPage.body.includes("Synchroniser cette compétition"));
  check("plus d'avertissement de clé manquante", !syncPage.body.includes("n&#x27;est pas configurée"));

  db.close();

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERREUR:", e.stack); process.exit(1); });
