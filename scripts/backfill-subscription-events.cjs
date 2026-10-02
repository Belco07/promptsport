/**
 * Reconstitution ponctuelle du journal d'événements pour les abonnements
 * antérieurs au WP7e : un CREATED à la date de création, et un CANCELED à la
 * date de résiliation lorsqu'elle est connue. Chaque entrée est marquée
 * `source: "backfill"` pour la distinguer d'un événement reçu de Stripe.
 */
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");

const url = readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
const db = new Database();

const newId = () => "cevt" + crypto.randomBytes(10).toString("hex");
const insert = db.prepare(
  `INSERT INTO SubscriptionEvent (id, subscriptionId, type, metadata, createdAt)
   VALUES (?, ?, ?, ?, ?)`,
);

const subscriptions = db.prepare("SELECT id, status, createdAt, canceledAt FROM Subscription").all();
let created = 0;
let canceled = 0;

for (const subscription of subscriptions) {
  const existing = db
    .prepare("SELECT COUNT(*) AS c FROM SubscriptionEvent WHERE subscriptionId = ?")
    .get(subscription.id).c;
  if (existing > 0) continue;

  insert.run(
    newId(),
    subscription.id,
    "CREATED",
    JSON.stringify({ source: "backfill", note: "reconstitué depuis createdAt" }),
    subscription.createdAt,
  );
  created += 1;

  if (subscription.canceledAt) {
    insert.run(
      newId(),
      subscription.id,
      "CANCELED",
      JSON.stringify({ source: "backfill", note: "reconstitué depuis canceledAt" }),
      subscription.canceledAt,
    );
    canceled += 1;
  }
}

console.log(`reconstitution : ${created} CREATED, ${canceled} CANCELED`);
for (const row of db.prepare(
  `SELECT a.email, p.name, e.type, e.createdAt
   FROM SubscriptionEvent e
   JOIN Subscription s ON s.id = e.subscriptionId
   JOIN Plan p ON p.id = s.planId
   JOIN Author a ON a.id = s.userId
   ORDER BY e.createdAt`,
).all()) {
  console.log(`  ${row.email.padEnd(22)} ${row.name.padEnd(8)} ${row.type.padEnd(9)} ${row.createdAt}`);
}
db.close();
