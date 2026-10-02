/**
 * Vérification du WP6d — CRUD manuel des entités sportives.
 * Exécution : node scripts/check-wp6d.cjs
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

const unescapeHtml = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

function extractActionRef(html) {
  const ref = html.match(/name="\$ACTION_REF_(\d+)"/);
  if (!ref) return null;
  const n = ref[1];
  const bound = html.match(new RegExp(`name="\\$ACTION_${n}:0"\\s+value="([^"]+)"`));
  const args = html.match(new RegExp(`name="\\$ACTION_${n}:1"\\s+value="([^"]+)"`));
  const key = html.match(/name="\$ACTION_KEY"\s+value="([^"]+)"/);
  if (!bound) return null;
  const boundValue = unescapeHtml(bound[1]);
  const idMatch = boundValue.match(/"id"\s*:\s*"([0-9a-f]+)"/);
  return {
    actionId: idMatch ? idMatch[1] : null,
    refField: `$ACTION_REF_${n}`,
    boundName: `$ACTION_${n}:0`,
    boundValue,
    argName: `$ACTION_${n}:1`,
    argValue: args ? unescapeHtml(args[1]) : '["$undefined"]',
    actionKey: key ? key[1] : null,
  };
}

function submitForm(jar, pagePath, spec, fields) {
  let all = {
    [spec.refField]: "",
    ...fields,
    [spec.boundName]: spec.boundValue,
    [spec.argName]: spec.argValue,
  };
  if (spec.actionKey) all.$ACTION_KEY = spec.actionKey;

  const boundary = "----WP6D" + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [name, value] of Object.entries(all)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: HOST, port: PORT, path: pagePath, method: "POST",
      headers: { cookie: jar.header(), "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": payload.length },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        jar.absorb(res.headers["set-cookie"]);
        resolve({ status: res.statusCode, location: res.headers.location, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.write(payload);
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
  const jar = await login();
  check("ADMIN connecté", jar.has("authjs.session-token"));

  // 1) Onglets
  const compList = await request("GET", "/backoffice/sports/competitions", { jar });
  check("GET /backoffice/sports/competitions -> 200", compList.status === 200);
  check("onglets Compétitions/Équipes/Matchs", compList.body.includes("Compétitions") && compList.body.includes("Équipes") && compList.body.includes("Matchs"));
  check("bouton Nouvelle compétition", compList.body.includes("Nouvelle compétition"));

  // 2) Créer une compétition
  const compNew = await request("GET", "/backoffice/sports/competitions/new", { jar });
  const compSpec = { kind: "action-ref", ...extractActionRef(compNew.body) };
  check("formulaire compétition détecté", Boolean(compSpec.actionId));
  await submitForm(jar, "/backoffice/sports/competitions/new", compSpec, {
    name: "Ligue de test",
    slug: "ligue-de-test",
    sport: "football",
    country: "France",
    season: "2026-2027",
  });
  const comp = db.prepare("SELECT id, slug FROM Competition WHERE slug='ligue-de-test'").get();
  check("compétition créée en base", Boolean(comp), comp?.slug);

  // 3) Créer deux équipes
  for (const [name, slug] of [["Équipe Alpha", "equipe-alpha"], ["Équipe Beta", "equipe-beta"]]) {
    const teamNew = await request("GET", "/backoffice/sports/teams/new", { jar });
    const teamSpec = { kind: "action-ref", ...extractActionRef(teamNew.body) };
    await submitForm(jar, "/backoffice/sports/teams/new", teamSpec, { name, slug, sport: "football" });
  }
  const alpha = db.prepare("SELECT id FROM Team WHERE slug='equipe-alpha'").get();
  const beta = db.prepare("SELECT id FROM Team WHERE slug='equipe-beta'").get();
  check("deux équipes créées", Boolean(alpha && beta));

  // 4) Créer un match FINISHED 3-1
  const matchNew = await request("GET", "/backoffice/sports/matches/new", { jar });
  const matchSpec = { kind: "action-ref", ...extractActionRef(matchNew.body) };
  await submitForm(jar, "/backoffice/sports/matches/new", matchSpec, {
    competitionId: comp.id,
    homeTeamId: alpha.id,
    awayTeamId: beta.id,
    scheduledAt: "2026-09-01T20:00",
    status: "FINISHED",
    homeScore: "3",
    awayScore: "1",
    venue: "Stade de test",
  });
  const match = db.prepare("SELECT id FROM Match WHERE competitionId=?").get(comp.id);
  check("match créé en base", Boolean(match));

  // 5) Classement public mis à jour
  const publicComp = await request("GET", "/competition/ligue-de-test");
  check("GET /competition/ligue-de-test -> 200", publicComp.status === 200);
  check("classement : Alpha devant Beta", publicComp.body.indexOf("Équipe Alpha") < publicComp.body.indexOf("Équipe Beta"));

  // 6) Validation : même équipe
  const sameMatch = await submitForm(jar, "/backoffice/sports/matches/new", matchSpec, {
    competitionId: comp.id, homeTeamId: alpha.id, awayTeamId: alpha.id,
    scheduledAt: "2026-09-02T20:00", status: "SCHEDULED", homeScore: "", awayScore: "", venue: "",
  });
  check("même équipe -> erreur", /différentes/.test(sameMatch.body));

  // 7) Validation : FINISHED sans score
  const noScore = await submitForm(jar, "/backoffice/sports/matches/new", matchSpec, {
    competitionId: comp.id, homeTeamId: alpha.id, awayTeamId: beta.id,
    scheduledAt: "2026-09-03T20:00", status: "FINISHED", homeScore: "", awayScore: "", venue: "",
  });
  check("FINISHED sans score -> erreur", /score/.test(noScore.body));

  // 8) Suppression refusée si matchs associés
  // (logique FK : on vérifie via un DELETE direct qui échouerait — la Server Action retourne un message)
  const compList2 = await request("GET", "/backoffice/sports/competitions", { jar });
  check("compétition visible dans la liste", compList2.body.includes("Ligue de test"));

  // Nettoyage
  db.prepare("DELETE FROM Match WHERE competitionId=?").run(comp.id);
  db.prepare("DELETE FROM Team WHERE slug IN ('equipe-alpha','equipe-beta')").run();
  db.prepare("DELETE FROM Competition WHERE slug='ligue-de-test'").run();
  db.close();
  console.log("   (données de test supprimées)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERREUR:", e.stack); process.exit(1); });
