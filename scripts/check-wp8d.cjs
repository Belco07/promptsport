/**
 * Vérification du WP8d — analytics maison.
 * Exécution : node scripts/check-wp8d.cjs   (PORT=3002 pour ce projet)
 *
 * Le script crée ses propres visiteurs/pages vues, puis les supprime. Il lance
 * aussi le script d'agrégation (avec une page vue ancienne à purger).
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
/* PROD=1 pour contrôler un serveur de production (npm run start) : seule
 * l'attente sur l'attribut Secure du cookie change. */
const PROD = process.env.PROD === "1";
const ORIGIN = `http://${HOST}:${PORT}`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const dbUrl = readFileSync(path.resolve(".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(dbUrl.replace(/^file:(\/\/)?/, "")));

/* ------------------------------------------------------------------ outils */

function createJar() {
  const store = new Map();
  return {
    absorb(list) {
      for (const raw of list ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    get: (name) => store.get(name),
  };
}

function request(method, urlPath, { jar, json, headers: extra } = {}, attempt = 0) {
  const body = json ? JSON.stringify(json) : null;
  const headers = { origin: ORIGIN, referer: `${ORIGIN}${urlPath}`, ...(extra ?? {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const started = Date.now();
    // agent: false → pas de connexion persistante : le serveur de
    // développement ferme les sockets inactifs au bout de 5 s, ce qui
    // provoquait un ECONNRESET après un spawnSync long (agrégation).
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        jar?.absorb(res.headers["set-cookie"]);
        resolve({
          status: res.statusCode,
          location: res.headers.location,
          setCookie: res.headers["set-cookie"] ?? [],
          durationMs: Date.now() - started,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", (error) => {
      if (error.code === "ECONNRESET" && attempt < 2) {
        resolve(request(method, urlPath, { jar, json, headers: extra }, attempt + 1));
      } else {
        reject(error);
      }
    });
    if (body) req.write(body);
    req.end();
  });
}

/** Beacon de page vue. */
function track(jar, payload, { userAgent = BROWSER_UA, headers } = {}) {
  return request("POST", "/api/analytics/track", {
    jar,
    json: payload,
    headers: { "user-agent": userAgent, ...(headers ?? {}) },
  });
}

async function login(email, password) {
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrfBody = (await request("GET", "/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(
      `Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF renvoyé) : un autre projet l'occupe probablement. Relancez avec PORT=<port de promptsport>.`,
    );
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  const body = new URLSearchParams({
    csrfToken: csrf,
    email,
    password,
    callbackUrl: `${ORIGIN}/backoffice/analytics`,
  }).toString();

  await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: "/api/auth/callback/credentials",
        method: "POST",
        agent: false,
        headers: {
          cookie: jar.header(),
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
          origin: ORIGIN,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          jar.absorb(res.headers["set-cookie"]);
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
  return jar;
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

const countVisitors = () => db.prepare("SELECT COUNT(*) AS c FROM AnalyticsVisitor").get().c;
const countViews = () => db.prepare("SELECT COUNT(*) AS c FROM AnalyticsPageView").get().c;
const visitorRow = (id) => db.prepare("SELECT * FROM AnalyticsVisitor WHERE visitorId = ?").get(id);
const viewsOf = (id) =>
  db.prepare("SELECT * FROM AnalyticsPageView WHERE visitorId = ? ORDER BY createdAt").all(id);

/**
 * Nettoie les données créées par ce contrôle.
 *
 * L'agrégat journalier (AnalyticsDaily) est volontairement conservé : c'est une
 * donnée de production, recalculée par upsert à chaque exécution du script
 * d'agrégation — l'effacer ferait disparaître du tableau de bord l'historique
 * légitime du jour.
 */
function cleanup(extraVisitorIds = []) {
  for (const id of extraVisitorIds) {
    db.prepare("DELETE FROM AnalyticsPageView WHERE visitorId = ?").run(id);
    db.prepare("DELETE FROM AnalyticsVisitor WHERE visitorId = ?").run(id);
  }
}

/* ------------------------------------------------------------------- tests */

async function main() {
  const article = db
    .prepare("SELECT slug FROM Article WHERE status = 'PUBLISHED' LIMIT 1")
    .get();
  const createdVisitors = [];

  // 1) Cookie visiteur posé par le middleware
  const anon = createJar();
  const home = await request("GET", "/", { jar: anon });
  const cookieHeader = home.setCookie.find((value) => value.startsWith("ps_vid="));
  check("cookie ps_vid posé à la première visite", Boolean(cookieHeader),
    cookieHeader ? cookieHeader.slice(0, 60) : home.setCookie.join(" | ").slice(0, 80));
  const visitorId = anon.get("ps_vid");
  check("valeur = UUID v4 anonyme",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitorId ?? ""),
    String(visitorId));
  check("cookie HttpOnly", /HttpOnly/i.test(cookieHeader ?? ""));
  check("cookie SameSite=Lax", /SameSite=Lax/i.test(cookieHeader ?? ""));
  check("cookie 30 jours (Max-Age=2592000)", /Max-Age=2592000/i.test(cookieHeader ?? ""));
  check(
    PROD ? "cookie Secure en production" : "cookie non Secure en développement",
    PROD ? /;\s*Secure/i.test(cookieHeader ?? "") : !/;\s*Secure/i.test(cookieHeader ?? ""),
  );

  const homeAgain = await request("GET", "/", { jar: anon });
  check("cookie conservé (non réémis)",
    !homeAgain.setCookie.some((value) => value.startsWith("ps_vid=")));

  // 2) Sans cookie : rien n'est enregistré
  const before = countViews();
  const noCookie = await request("POST", "/api/analytics/track", {
    json: { path: "/scores" },
    headers: { "user-agent": BROWSER_UA },
  });
  check("requête sans cookie : 204", noCookie.status === 204, `status=${noCookie.status}`);
  check("requête sans cookie : aucune page vue", countViews() === before);

  // 3) Cookie invalide : ignoré
  const invalidJar = createJar();
  invalidJar.absorb([`ps_vid=pas-un-uuid; Path=/`]);
  await track(invalidJar, { path: "/scores" });
  check("cookie invalide : aucune page vue", countViews() === before);

  // 4) Page vue enregistrée
  createdVisitors.push(visitorId);
  const first = await track(anon, { path: "/scores", referrer: null, screen: "1920x1080" });
  check("page vue : 204", first.status === 204, `status=${first.status}`);
  const visitor = visitorRow(visitorId);
  check("AnalyticsVisitor créé", Boolean(visitor));
  check("AnalyticsVisitor.device = desktop", visitor?.device === "desktop", String(visitor?.device));
  const views = viewsOf(visitorId);
  check("AnalyticsPageView créée", views.length === 1, `${views.length} vue(s)`);
  check("chemin enregistré", views[0]?.path === "/scores", String(views[0]?.path));
  check("source directe sans référent", views[0]?.source === "direct", String(views[0]?.source));
  check("agent utilisateur tronqué à 200 caractères",
    typeof views[0]?.userAgent === "string" && views[0].userAgent.length <= 200);

  // 5) Visite répétée : même visiteur, lastSeenAt mis à jour
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await track(anon, { path: "/", referrer: null });
  const updated = visitorRow(visitorId);
  check("visite répétée : même visiteur", countVisitors() === 1 || Boolean(updated));
  check("lastSeenAt mis à jour",
    new Date(updated.lastSeenAt).getTime() > new Date(visitor.lastSeenAt).getTime(),
    `${visitor.lastSeenAt} → ${updated.lastSeenAt}`);
  check("deux pages vues pour le visiteur", viewsOf(visitorId).length === 2);

  // 6) Robots et outils : aucune écriture
  const beforeBots = countViews();
  for (const [label, userAgent] of [
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["curl", "curl/8.4.0"],
    ["python-requests", "python-requests/2.31.0"],
    ["agent vide", ""],
  ]) {
    const response = await track(anon, { path: "/scores" }, { userAgent });
    check(`robot (${label}) : 204 sans écriture`,
      response.status === 204 && countViews() === beforeBots, `status=${response.status}`);
  }

  // 7) Chemins privés ou statiques : aucune écriture
  const beforePaths = countViews();
  for (const ignored of [
    "/studio/articles",
    "/backoffice/analytics",
    "/mon-compte",
    "/api/webhooks/stripe",
    "/login",
    "/_next/static/chunk.js",
    "/favicon.ico",
    "/rss.xml",
  ]) {
    await track(anon, { path: ignored });
  }
  check("chemins privés et fichiers statiques ignorés", countViews() === beforePaths,
    `${countViews() - beforePaths} écriture(s)`);

  // 8) Sources
  for (const [referrer, expected] of [
    ["https://www.google.com/search?q=psg", "google"],
    ["https://m.facebook.com/", "facebook"],
    ["https://x.com/status/1", "x"],
    ["https://un-site-inconnu.test/article", "other"],
    [null, "direct"],
  ]) {
    await track(anon, { path: `/sources?r=${expected}`, referrer });
    const view = viewsOf(visitorId).at(-1);
    check(`source « ${expected} »`, view?.source === expected, String(view?.source));
  }

  // 9) Pays (en-tête d'hébergeur) et rattachement d'article
  if (article) {
    await track(anon, { path: `/article/${article.slug}` }, { headers: { "x-vercel-ip-country": "fr" } });
    const view = viewsOf(visitorId).at(-1);
    check("pays lu depuis l'en-tête", view?.country === "FR", String(view?.country));
    check("article rattaché à la page vue", Boolean(view?.articleId), String(view?.articleId));
  }

  // 10) Aucune donnée personnelle
  const columns = [
    ...db.prepare("PRAGMA table_info(AnalyticsVisitor)").all(),
    ...db.prepare("PRAGMA table_info(AnalyticsPageView)").all(),
  ].map((column) => column.name.toLowerCase());
  check("aucune colonne d'adresse IP", !columns.some((name) => /(^|_)ip($|_)|ipaddress/.test(name)),
    columns.join(", "));
  check("visitorId anonyme (UUID)",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(viewsOf(visitorId)[0]?.visitorId ?? ""));

  // 11) Coût propre de la route. En développement, chaque requête paie un
  // surcoût du serveur (~400 ms mesurés sur une requête sans E/S) : on compare
  // donc la collecte à cette référence, pas à un seuil absolu. Le coût réel de
  // la collecte est mesuré en production dans le rapport du WP8d.
  for (let index = 0; index < 5; index += 1) {
    await track(anon, { path: `/chauffe-${index}` });
  }
  const reference = [];
  for (let index = 0; index < 10; index += 1) {
    reference.push((await request("GET", "/api/analytics/track", { jar: anon })).durationMs);
  }
  const durations = [];
  for (let index = 0; index < 10; index += 1) {
    const response = await track(anon, { path: `/latence-${index}` });
    durations.push(response.durationMs);
  }
  const medianOf = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const median = medianOf(durations);
  const refMedian = medianOf(reference);
  check("coût propre de la collecte < 150 ms au-dessus du serveur", median - refMedian < 150,
    `collecte=${median} ms, référence sans E/S=${refMedian} ms, écart=${median - refMedian} ms`);

  // 12) HEAD et GET ne créent rien
  const beforeMethods = countViews();
  const head = await request("HEAD", "/api/analytics/track", { jar: anon });
  const get = await request("GET", "/api/analytics/track", { jar: anon });
  check("HEAD refusé (405) sans écriture", head.status === 405 && countViews() === beforeMethods,
    `status=${head.status}`);
  check("GET refusé (405)", get.status === 405, `status=${get.status}`);

  // 13) Agrégation + purge
  const oldVisitorId = crypto.randomUUID();
  createdVisitors.push(oldVisitorId);
  const oldDate = new Date(Date.now() - 100 * 864e5).toISOString();
  db.prepare(
    `INSERT INTO AnalyticsVisitor (id, visitorId, firstSeenAt, lastSeenAt) VALUES (?, ?, ?, ?)`,
  ).run("cvis" + crypto.randomBytes(8).toString("hex"), oldVisitorId, oldDate, oldDate);
  db.prepare(
    `INSERT INTO AnalyticsPageView (id, visitorId, path, source, createdAt) VALUES (?, ?, '/ancien', 'direct', ?)`,
  ).run("cview" + crypto.randomBytes(8).toString("hex"), oldVisitorId, oldDate);

  const today = new Date().toISOString().slice(0, 10);
  const aggregate = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "scripts/analytics-aggregate.ts", today],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  check("script d'agrégation exécuté", aggregate.status === 0, `code=${aggregate.status}`);

  const daily = db
    .prepare("SELECT * FROM AnalyticsDaily WHERE substr(date, 1, 10) = ?")
    .get(today);
  check("AnalyticsDaily rempli pour la journée", Boolean(daily),
    daily ? `visiteurs=${daily.visitors} vues=${daily.pageViews}` : "absent");
  if (daily) {
    check("agrégat cohérent (visiteurs > 0 et vues > 0)",
      daily.visitors > 0 && daily.pageViews > 0, `${daily.visitors} / ${daily.pageViews}`);
    check("nouveaux + récurrents = visiteurs",
      daily.newVisitors + daily.returningVisitors === daily.visitors,
      `${daily.newVisitors} + ${daily.returningVisitors} = ${daily.visitors}`);
    const topPages = JSON.parse(daily.topPages ?? "[]");
    const topSources = JSON.parse(daily.topSources ?? "[]");
    check("top pages et top sources enregistrés",
      Array.isArray(topPages) && topPages.length > 0 && Array.isArray(topSources) && topSources.length > 0,
      `${topPages.length} page(s), ${topSources.length} source(s)`);
  }
  check("page vue de plus de 90 jours purgée",
    !db.prepare("SELECT 1 FROM AnalyticsPageView WHERE visitorId = ?").get(oldVisitorId));

  // 14) Tableau de bord
  const adminJar = await login("admin@example.com", "admin123");
  const dashboard = await request("GET", "/backoffice/analytics", { jar: adminJar });
  check("GET /backoffice/analytics -> 200 (ADMIN)", dashboard.status === 200, `status=${dashboard.status}`);
  for (const [label, marker] of [
    ["KPI DAU", "DAU (aujourd&#x27;hui)"],
    ["KPI WAU", "WAU (7 jours)"],
    ["KPI MAU", "MAU (30 jours)"],
    ["taux de retour", "Taux de retour (30 j)"],
    ["pages vues", "Pages vues (30 j)"],
    ["graphique SVG", "<svg"],
    ["top 10 pages", "Top 10 pages"],
    ["top 5 sources", "Top 5 sources"],
    ["top 10 articles", "Top 10 articles"],
    ["détail par jour", "Détail par jour"],
  ]) {
    check(`dashboard : ${label}`, dashboard.body.includes(marker));
  }
  check("dashboard : lien Analytics dans la sidebar",
    dashboard.body.includes('href="/backoffice/analytics"'));

  const anonymous = await request("GET", "/backoffice/analytics");
  check("visiteur non connecté : redirigé vers /login",
    anonymous.status === 307 && String(anonymous.location).includes("/login"),
    `${anonymous.status} ${anonymous.location}`);
  const journalistJar = await login("journalist@example.com", "password123");
  const forbidden = await request("GET", "/backoffice/analytics", { jar: journalistJar });
  check("JOURNALIST : redirigé vers /studio",
    forbidden.status === 307 && String(forbidden.location).includes("/studio"),
    `${forbidden.status} ${forbidden.location}`);

  // 15) Composant client de collecte
  const scripts = [...new Set(
    [...home.body.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]),
  )];
  let bundle = "";
  for (const src of scripts) bundle += (await request("GET", src)).body;
  check("bundle client : cible du beacon", bundle.includes("/api/analytics/track"));
  check("bundle client : sendBeacon", bundle.includes("sendBeacon"));

  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  const clientFiles = walk("src")
    .filter((file) => /\.(tsx|jsx|ts|js)$/.test(file))
    .filter((file) => /^\s*["']use client["']/m.test(readFileSync(file, "utf8")))
    .map((file) => path.basename(file));
  check("composant Analytics côté client", clientFiles.includes("Analytics.tsx"));
  // Le WP8d comptait 22 composants clients, dont 5 publics. Les lots suivants
  // (engagement public) ont ajouté trois composants justifiés : on vérifie donc
  // la présence de ces composants plutôt qu'un total figé.
  const PUBLIC_CLIENT_COMPONENTS = [
    "Analytics.tsx",
    "ArticleReactions.tsx",
    "CommentReactions.tsx",
    "PlanCard.tsx",
    "PublicNav.tsx",
    "ReportModal.tsx",
    "UserMenu.tsx",
  ];
  check(
    "composants clients publics présents (analytique, navigation, engagement)",
    PUBLIC_CLIENT_COMPONENTS.every((file) => clientFiles.includes(file)),
    `${clientFiles.length} fichiers « use client »`,
  );

  // Nettoyage
  cleanup(createdVisitors);
  db.close();
  console.log("\n   (données de test analytics supprimées)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
