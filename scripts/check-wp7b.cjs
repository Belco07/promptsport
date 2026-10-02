/**
 * Vérification du WP7b — intégration Stripe (partie vérifiable sans clés).
 * Exécution : node scripts/check-wp7b.cjs
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const crypto = require("node:crypto");
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

function request(method, urlPath, { jar, form, headers: extra } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = { ...(extra ?? {}) };
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

/** POST JSON brut (pour le webhook). */
function postRaw(urlPath, payload, extraHeaders = {}) {
  const body = Buffer.from(payload);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method: "POST",
        headers: { "content-type": "application/json", "content-length": body.length, ...extraHeaders } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.write(body);
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

/** Valeur effective d'une variable de .env (dernière occurrence gagnante, comme dotenv). */
function envValue(name) {
  const content = readFileSync(path.resolve(".env"), "utf8");
  let value = null;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && m[1] === name) value = m[2];
  }
  return value;
}

const cuid = () =>
  "c" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0") +
  crypto.randomBytes(2).toString("hex").slice(0, 4) + crypto.randomBytes(4).toString("hex").slice(0, 8);

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function login(email = "admin@example.com", password = "admin123") {
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
    jar, form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/abonnement` },
  });
  return jar;
}

async function main() {
  const db = new Database(dbPath());

  // 1) Variables d'environnement déclarées
  const env = readFileSync(path.resolve(".env"), "utf8");
  check("STRIPE_SECRET_KEY déclarée", /STRIPE_SECRET_KEY=/.test(env));
  check("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY déclarée", /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=/.test(env));
  check("STRIPE_WEBHOOK_SECRET déclarée", /STRIPE_WEBHOOK_SECRET=/.test(env));

  // 2) Colonne stripeCustomerId
  const cols = db.prepare("PRAGMA table_info(Author)").all().map((c) => c.name);
  check("Author.stripeCustomerId", cols.includes("stripeCustomerId"));

  // 3) Page /abonnement (anonyme)
  const anon = await request("GET", "/abonnement");
  check("GET /abonnement -> 200", anon.status === 200, `status=${anon.status}`);
  check("titre « Abonnez-vous »", anon.body.includes("Abonnez-vous"));

  // L'avertissement « clé Stripe absente » doit apparaître si et seulement si
  // STRIPE_SECRET_KEY n'est pas renseignée (l'assertion ne dépend donc pas de
  // l'état des clés au moment du test).
  const stripeKey = envValue("STRIPE_SECRET_KEY");
  const warned = anon.body.includes("STRIPE_SECRET_KEY");
  check("avertissement clé Stripe cohérent avec la configuration",
    warned === !stripeKey,
    `clé ${stripeKey ? "renseignée" : "absente"} -> avertissement ${warned ? "affiché" : "absent"}`);

  // 4) Avec un plan de test : carte + bouton
  const planId = cuid();
  // Un contrôle interrompu peut avoir laissé le plan de test : on repart propre.
  db.prepare("DELETE FROM Plan WHERE slug = ?").run("premium-mensuel-wp7b");
  db.prepare(`INSERT INTO Plan (id,name,slug,description,price,currency,interval,active,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(planId, "Premium Mensuel Test", "premium-mensuel-wp7b", "Accès complet", 999, "EUR", "MONTH", 1);

  const withPlan = await request("GET", "/abonnement");
  check("plan affiché", withPlan.body.includes("Premium Mensuel Test"));
  check("prix formaté « 9,99 € / mois »", withPlan.body.includes("9,99") && withPlan.body.includes("/ mois"));

  // Anonyme : le bouton S'abonner renvoie vers /login
  const subscribeBlock = withPlan.body.slice(withPlan.body.indexOf("S&#x27;abonner") - 300, withPlan.body.indexOf("S&#x27;abonner") + 50);
  check("anonyme : « S'abonner » pointe vers /login", /href="\/login"/.test(subscribeBlock), subscribeBlock.slice(0, 120).replace(/\s+/g, " "));

  // Connecté : l'état affiché dépend des abonnements réellement actifs en base
  // (un abonnement actif bloque désormais tout nouvel achat, y compris pour un
  // plan déjà détenu : un membre à vie ne doit pas pouvoir le racheter).
  for (const account of [
    { email: "journalist@example.com", password: "password123" },
    { email: "admin@example.com", password: "admin123" },
  ]) {
    const accountJar = await login(account.email, account.password);
    const page = await request("GET", "/abonnement", { jar: accountJar });
    const user = db.prepare("SELECT id FROM Author WHERE email = ?").get(account.email);
    const active = user
      ? db
          .prepare(
            "SELECT COUNT(*) AS c FROM Subscription WHERE userId = ? AND status IN ('ACTIVE','TRIALING')",
          )
          .get(user.id).c
      : 0;

    if (active > 0) {
      check(`${account.email} : ${active} abonnement(s) actif(s) -> achat bloqué`,
        page.body.includes("Un abonnement est déjà actif") && page.body.includes("Gérer mon abonnement"));
    } else {
      check(`${account.email} : aucun abonnement -> bouton « S'abonner »`,
        page.body.includes("S&#x27;abonner"));
    }
  }

  // 5) Pages succès / annulation
  const success = await request("GET", "/abonnement/success");
  check("GET /abonnement/success -> 200", success.status === 200, `status=${success.status}`);
  check("message de confirmation", success.body.includes("abonnement est actif"));
  const cancel = await request("GET", "/abonnement/cancel");
  check("GET /abonnement/cancel -> 200", cancel.status === 200, `status=${cancel.status}`);

  // 6) Navigation publique : lien Abonnement
  const home = await request("GET", "/");
  check("lien « Abonnement » dans la nav publique", home.body.includes('href="/abonnement"'));

  // 7) Webhook : refus d'une requête non signée
  const badSig = await postRaw("/api/webhooks/stripe", JSON.stringify({ type: "checkout.session.completed" }), {
    "stripe-signature": "t=123,v1=deadbeef",
  });
  check(
    "webhook : signature invalide rejetée",
    badSig.status === 400 || badSig.status === 500,
    `status=${badSig.status}`,
  );
  check(
    "webhook : message d'erreur explicite",
    /signature|SECRET|Signature/i.test(badSig.body),
    badSig.body.slice(0, 140).replace(/\s+/g, " "),
  );

  // Nettoyage
  db.prepare("DELETE FROM Plan WHERE id=?").run(planId);
  db.close();
  console.log("   (plan de test supprimé)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERREUR:", e.stack); process.exit(1); });
