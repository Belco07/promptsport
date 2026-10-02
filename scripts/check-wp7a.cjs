/**
 * Vérification du WP7a — modèles d'abonnement + interface admin.
 * Crée des données de test, vérifie l'admin, puis les supprime.
 * Exécution : node scripts/check-wp7a.cjs
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

const cuid = () =>
  "c" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0") +
  crypto.randomBytes(2).toString("hex").slice(0, 4) + crypto.randomBytes(4).toString("hex").slice(0, 8);

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
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
    jar, form: { csrfToken: csrf, email: "admin@example.com", password: "admin123", callbackUrl: `${ORIGIN}/backoffice` },
  });
  return jar;
}

async function main() {
  const db = new Database(dbPath());
  db.pragma("foreign_keys = ON");

  // Tables présentes
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  check("table Plan", tables.includes("Plan"));
  check("table Subscription", tables.includes("Subscription"));
  check("table Payment", tables.includes("Payment"));
  const cols = db.prepare("PRAGMA table_info(Author)").all().map((c) => c.name);
  check("Author.isPremium", cols.includes("isPremium"));

  // Données de test : 2 plans, 2 abonnements actifs, 1 paiement
  const admin = db.prepare("SELECT id, email FROM Author WHERE email='admin@example.com'").get();
  const other = db.prepare("SELECT id, email FROM Author WHERE email<>'admin@example.com' ORDER BY createdAt LIMIT 1").get();

  const monthlyPlan = cuid(), annualPlan = cuid();
  // Un contrôle interrompu peut avoir laissé ses plans derrière lui : on repart
  // d'un état propre (sinon « UNIQUE constraint failed: Plan.slug »).
  const testPlanSlugs = ["premium-mensuel-test", "premium-annuel-test"];
  const subscriptionsOfTestPlans = `SELECT id FROM Subscription WHERE planId IN (SELECT id FROM Plan WHERE slug IN (?,?))`;
  db.prepare(`DELETE FROM Payment WHERE subscriptionId IN (${subscriptionsOfTestPlans})`).run(...testPlanSlugs);
  db.prepare(`DELETE FROM SubscriptionEvent WHERE subscriptionId IN (${subscriptionsOfTestPlans})`).run(...testPlanSlugs);
  db.prepare(`DELETE FROM Subscription WHERE planId IN (SELECT id FROM Plan WHERE slug IN (?,?))`).run(...testPlanSlugs);
  db.prepare("DELETE FROM Plan WHERE slug IN (?,?)").run(...testPlanSlugs);
  db.prepare(`INSERT INTO Plan (id,name,slug,description,price,currency,interval,active,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(monthlyPlan, "Premium Mensuel", "premium-mensuel-test", "Accès complet", 999, "EUR", "MONTH", 1);
  db.prepare(`INSERT INTO Plan (id,name,slug,description,price,currency,interval,active,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(annualPlan, "Premium Annuel", "premium-annuel-test", "Accès complet 1 an", 9990, "EUR", "YEAR", 1);

  const sub1 = cuid(), sub2 = cuid();
  const now = new Date().toISOString();
  const end = new Date(Date.now() + 30 * 864e5).toISOString();
  db.prepare(`INSERT INTO Subscription (id,userId,planId,status,currentPeriodStart,currentPeriodEnd,cancelAtPeriodEnd,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(sub1, admin.id, monthlyPlan, "ACTIVE", now, end, 0);
  db.prepare(`INSERT INTO Subscription (id,userId,planId,status,currentPeriodStart,currentPeriodEnd,cancelAtPeriodEnd,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(sub2, other.id, annualPlan, "ACTIVE", now, end, 0);

  db.prepare(`INSERT INTO Payment (id,subscriptionId,userId,amount,currency,status,stripePaymentIntentId,paidAt,createdAt,updatedAt)
              VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .run(cuid(), sub1, admin.id, 999, "EUR", "SUCCEEDED", "pi_test_123", now);

  console.log("   (données de test créées : 2 plans, 2 abonnements actifs, 1 paiement)");

  const jar = await login();
  check("ADMIN connecté", jar.has("authjs.session-token"));

  // Onglets
  const plansPage = await request("GET", "/backoffice/subscriptions?tab=plans", { jar });
  check("GET /backoffice/subscriptions -> 200", plansPage.status === 200, `status=${plansPage.status}`);
  check("onglets Plans/Abonnements/Paiements", plansPage.body.includes("Plans") && plansPage.body.includes("Abonnements") && plansPage.body.includes("Paiements"));
  check("plan mensuel affiché", plansPage.body.includes("Premium Mensuel"));
  check("prix formaté en €", plansPage.body.includes("9,99") && plansPage.body.includes("99,90"));
  check("intervalle affiché", plansPage.body.includes("Mensuel") && plansPage.body.includes("Annuel"));

  const subsPage = await request("GET", "/backoffice/subscriptions?tab=subscriptions", { jar });
  check("onglet Abonnements : utilisateur", subsPage.body.includes("admin@example.com"));
  check("onglet Abonnements : statut actif", subsPage.body.includes("Actif"));

  const payPage = await request("GET", "/backoffice/subscriptions?tab=payments", { jar });
  check("onglet Paiements : montant", payPage.body.includes("9,99"));
  check("onglet Paiements : ID Stripe", payPage.body.includes("pi_test_123"));

  // Tableau de bord : les valeurs affichées sont comparées à celles recalculées
  // depuis la base, afin que le contrôle ne dépende pas des abonnements
  // réellement présents (par exemple un plan à vie acheté pour de vrai).
  const activeRows = db
    .prepare(
      `SELECT p.price AS price, p.interval AS interval
       FROM Subscription s JOIN Plan p ON p.id = s.planId
       WHERE s.status = 'ACTIVE'`,
    )
    .all();
  const expectedActive = activeRows.length;
  const expectedMrr = (
    activeRows.reduce(
      (total, r) =>
        total + (r.interval === "MONTH" ? r.price : r.interval === "YEAR" ? Math.round(r.price / 12) : 0),
      0,
    ) / 100
  )
    .toFixed(2)
    .replace(".", ",");
  const expectedPaid = (
    db
      .prepare("SELECT amount FROM Payment WHERE status = 'SUCCEEDED'")
      .all()
      .reduce((total, p) => total + p.amount, 0) / 100
  )
    .toFixed(2)
    .replace(".", ",");

  const home = await request("GET", "/backoffice", { jar });
  check("backoffice : libellé MRR", home.body.includes("Revenu mensuel récurrent"));
  check(`backoffice : MRR calculé ${expectedMrr} €`, home.body.includes(expectedMrr));
  check(`backoffice : abonnements actifs = ${expectedActive}`,
    new RegExp(`Abonnements actifs</p>\\s*<p[^>]*>${expectedActive}<`).test(home.body));
  check(`backoffice : total encaissé ${expectedPaid} €`, home.body.includes(expectedPaid));
  check("sidebar : lien Abonnements", home.body.includes("/backoffice/subscriptions"));

  // Nettoyage
  db.prepare("DELETE FROM Payment WHERE subscriptionId IN (?,?)").run(sub1, sub2);
  db.prepare("DELETE FROM Subscription WHERE id IN (?,?)").run(sub1, sub2);
  db.prepare("DELETE FROM Plan WHERE id IN (?,?)").run(monthlyPlan, annualPlan);
  db.close();
  console.log("   (données de test supprimées)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERREUR:", e.stack); process.exit(1); });
