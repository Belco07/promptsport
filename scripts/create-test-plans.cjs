/**
 * Création manuelle de plans d'abonnement pour les essais (développement).
 *
 * Ce script N'EST PAS un seed automatique : il n'est jamais lancé par
 * `npm run db:seed` ni au démarrage. Il sert uniquement à disposer de plans
 * pour tester le tunnel Stripe, aucun écran ne permettant encore de créer un
 * plan (WP7a livrait la consultation, pas le CRUD).
 *
 * Utilisation : node scripts/create-test-plans.cjs
 * Les identifiants de prix Stripe restent vides : ils sont créés à la volée
 * lors de la première session Checkout.
 */
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");

const PLANS = [
  {
    name: "Mensuel",
    slug: "mensuel",
    description: "Tous les articles premium, sans engagement.",
    price: 999,
    interval: "MONTH",
  },
  {
    name: "Annuel",
    slug: "annuel",
    description: "Deux mois offerts par rapport au mensuel.",
    price: 9900,
    interval: "YEAR",
  },
  {
    name: "À vie",
    slug: "a-vie",
    description: "Un paiement unique, accès permanent.",
    price: 29900,
    interval: "LIFETIME",
  },
];

function dbPath() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const content = readFileSync(path.resolve(".env"), "utf8");
    const match = content.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    url = match ? match[1] : null;
  }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

const newId = () =>
  "c" + Date.now().toString(36) + crypto.randomBytes(6).toString("hex");

const db = new Database();

for (const plan of PLANS) {
  const existing = db.prepare("SELECT id FROM Plan WHERE slug = ?").get(plan.slug);
  if (existing) {
    db.prepare(
      `UPDATE Plan SET name = ?, description = ?, price = ?, currency = 'EUR',
       interval = ?, active = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(plan.name, plan.description, plan.price, plan.interval, existing.id);
    console.log(`mis à jour : ${plan.name} (${(plan.price / 100).toFixed(2)} €)`);
  } else {
    db.prepare(
      `INSERT INTO Plan (id, name, slug, description, price, currency, interval, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'EUR', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(newId(), plan.name, plan.slug, plan.description, plan.price, plan.interval);
    console.log(`créé       : ${plan.name} (${(plan.price / 100).toFixed(2)} €)`);
  }
}

console.log("\nplans en base :");
for (const row of db.prepare("SELECT name, slug, price, interval, active FROM Plan ORDER BY price").all()) {
  console.log(`  ${row.name.padEnd(10)} ${(row.price / 100).toFixed(2)} € ${row.interval.padEnd(9)} actif=${row.active}`);
}
db.close();
