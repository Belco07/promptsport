/**
 * Vérification de l'annulation automatique des abonnements récurrents lors d'un
 * achat de plan à vie (mode test Stripe).
 *
 * Scénario complet, rejoué à chaque exécution :
 *   1. un abonnement annuel RÉEL est créé pour journalist@example.com ;
 *   2. un événement `checkout.session.completed` d'achat unique (plan À vie) est
 *      déclenché par la CLI Stripe avec les métadonnées de ce compte ;
 *   3. on vérifie que l'abonnement annuel est résilié côté Stripe ET en base,
 *      que l'accès premium est conservé et que les deux paiements sont là ;
 *   4. les données de test sont supprimées automatiquement.
 *
 * Exécution : node scripts/check-auto-cancel.cjs
 * Nécessite le serveur de dev (port 3000) et un `stripe listen` actif vers
 * /api/webhooks/stripe. Le script lance lui-même la CLI Stripe.
 */
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const path = require("node:path");
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const STRIPE_CLI = "C:\\Users\\Belco\\AppData\\Roaming\\npm\\stripe.cmd";
const PORT = Number(process.env.PORT || 3000);

const env = {};
for (const line of readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const mod = require("stripe");
const Stripe = mod.Stripe ?? mod.default ?? mod;
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const db = new Database(path.resolve(env.DATABASE_URL.replace(/^file:(\/\/)?/, "")));

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function state(userId) {
  const rows = db
    .prepare(
      `SELECT s.status, s.stripeSubscriptionId, p.interval
       FROM Subscription s JOIN Plan p ON p.id = s.planId
       WHERE s.userId = ? ORDER BY s.createdAt`,
    )
    .all(userId);
  return {
    rows,
    annual: rows.find((r) => r.interval === "YEAR"),
    lifetime: rows.find((r) => r.interval === "LIFETIME"),
    premium: db.prepare("SELECT isPremium FROM Author WHERE id = ?").get(userId)?.isPremium,
    payments: db.prepare("SELECT COUNT(*) AS c FROM Payment WHERE userId = ?").get(userId).c,
  };
}

async function main() {
  const user = db.prepare("SELECT id, email FROM Author WHERE email = ?").get("journalist@example.com");
  if (!user) throw new Error("journalist@example.com introuvable");
  const annual = db.prepare("SELECT id, stripePriceId FROM Plan WHERE interval = 'YEAR'").get();
  const lifetime = db.prepare("SELECT id FROM Plan WHERE interval = 'LIFETIME'").get();
  if (!annual?.stripePriceId || !lifetime) throw new Error("plans Annuel et À vie requis");

  // État de départ propre pour ce compte.
  db.prepare("DELETE FROM Payment WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId IN (SELECT id FROM Subscription WHERE userId = ?)").run(user.id);
  db.prepare("DELETE FROM Subscription WHERE userId = ?").run(user.id);
  db.prepare("UPDATE Author SET isPremium = 0, stripeCustomerId = NULL WHERE id = ?").run(user.id);

  let customerId = null;
  let stripeSubscriptionId = null;

  try {
    // 1) Client + abonnement annuel réels.
    const customer = await stripe.customers.create({
      email: user.email,
      name: "Journaliste Test",
      metadata: { userId: user.id, purpose: "check-auto-cancel" },
    });
    customerId = customer.id;
    db.prepare("UPDATE Author SET stripeCustomerId = ? WHERE id = ?").run(customerId, user.id);

    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
    await stripe.paymentMethods.attach(pm.id, { customer: customerId });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: annual.stripePriceId }],
      default_payment_method: pm.id,
      metadata: { planId: annual.id, userId: user.id },
      payment_behavior: "error_if_incomplete",
    });
    stripeSubscriptionId = subscription.id;
    check("abonnement annuel réel créé côté Stripe", subscription.status === "active", subscription.status);

    for (let i = 0; i < 25 && state(user.id).annual?.status !== "ACTIVE"; i += 1) await sleep(1000);
    check("abonnement annuel actif en base (webhooks reçus)", state(user.id).annual?.status === "ACTIVE",
      String(state(user.id).annual?.status));

    // 2) Achat du plan à vie (événement réel de la CLI Stripe).
    const trigger = spawnSync(
      STRIPE_CLI,
      [
        "trigger", "checkout.session.completed",
        "--add", `checkout_session:metadata.planId=${lifetime.id}`,
        "--add", `checkout_session:metadata.userId=${user.id}`,
        "--override", `checkout_session:customer=${customerId}`,
      ],
      { stdio: "inherit", shell: true },
    );
    check("événement checkout.session.completed déclenché", trigger.status === 0,
      trigger.error ? `erreur=${trigger.error.message}` : `code=${trigger.status}`);

    // 3) Vérifications.
    let current = state(user.id);
    for (let i = 0; i < 25 && current.lifetime?.status !== "ACTIVE"; i += 1) {
      await sleep(1000);
      current = state(user.id);
    }
    for (let i = 0; i < 15 && current.annual?.status !== "CANCELED"; i += 1) {
      await sleep(1000);
      current = state(user.id);
    }

    check("ligne du plan à vie créée et active", current.lifetime?.status === "ACTIVE", String(current.lifetime?.status));
    check("abonnement annuel résilié automatiquement en base", current.annual?.status === "CANCELED",
      String(current.annual?.status));
    check("abonnement annuel résilié côté Stripe",
      (await stripe.subscriptions.retrieve(stripeSubscriptionId)).status === "canceled");
    check("accès premium conservé grâce au plan à vie", current.premium === 1, String(current.premium));
    check("les deux paiements sont enregistrés", current.payments >= 2, `${current.payments} paiement(s)`);
  } finally {
    // 4) Nettoyage systématique, même en cas d'échec.
    if (stripeSubscriptionId) {
      await stripe.subscriptions.cancel(stripeSubscriptionId).catch(() => {});
    }
    db.prepare("DELETE FROM Payment WHERE userId = ?").run(user.id);
    db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId IN (SELECT id FROM Subscription WHERE userId = ?)").run(user.id);
    db.prepare("DELETE FROM Subscription WHERE userId = ?").run(user.id);
    db.prepare("UPDATE Author SET isPremium = 0, stripeCustomerId = NULL WHERE id = ?").run(user.id);
    if (customerId) await stripe.customers.del(customerId).catch(() => {});
    db.close();
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  console.log("(données de test supprimées)");
  // `process.exitCode` plutôt que `process.exit` : laisse Node terminer ses
  // écritures (et n'écrase pas un code de sortie déjà positionné).
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
