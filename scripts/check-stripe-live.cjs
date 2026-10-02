/**
 * Vérification RÉELLE du WP7b (Stripe, mode test) — le serveur doit tourner sur
 * le port 3000 et `stripe listen` doit rediriger les événements vers
 * /api/webhooks/stripe.
 *
 * Phases (à enchaîner, les événements Stripe étant asynchrones) :
 *   node scripts/check-stripe-live.cjs setup          # plan + client + Checkout + portail
 *   (stripe trigger checkout.session.completed ...)   # voir la sortie de setup
 *   node scripts/check-stripe-live.cjs verify-create
 *   (facture réelle payée sur l'abonnement créé)
 *   node scripts/check-stripe-live.cjs verify-invoice
 *   (stripe trigger customer.subscription.deleted ...)
 *   node scripts/check-stripe-live.cjs verify-delete
 *   node scripts/check-stripe-live.cjs cleanup
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync, writeFileSync, existsSync, unlinkSync } = require("node:fs");
const crypto = require("node:crypto");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;
const CONTEXT = path.resolve("scripts/.stripe-live-context.json");

/* Identifiants des Server Actions : lus dans le manifeste Next (ils changent à
 * chaque compilation, un identifiant codé en dur devient obsolète). */
function actionIds() {
  const manifestPath = path.resolve(
    ".next/server/app/abonnement/page/server-reference-manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const byName = {};
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    if (entry?.exportedName) byName[entry.exportedName] = id;
  }
  return byName;
}

/* ------------------------------------------------------------------ outils */

function readEnv() {
  const out = {};
  for (const line of readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) out[m[1]] = m[2]; // dernière occurrence gagnante (comme dotenv)
  }
  return out;
}

function dbPath() {
  const url = process.env.DATABASE_URL || readEnv().DATABASE_URL;
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

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
  };
}

function request(method, urlPath, { jar, form, headers: extra } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = { ...(extra ?? {}) };
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

/** Appel d'une Server Action (protocole Next : en-tête Next-Action + args JSON). */
function callAction(urlPath, actionId, args, jar) {
  const body = JSON.stringify(args);
  return new Promise((resolve, reject) => {
    const headers = {
      "content-type": "text/plain;charset=UTF-8",
      "content-length": Buffer.byteLength(body),
      "next-action": actionId,
      origin: ORIGIN,
      referer: `${ORIGIN}${urlPath}`,
      cookie: jar.header(),
    };
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method: "POST", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        jar.absorb(res.headers["set-cookie"]);
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
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
    jar,
    form: {
      csrfToken: csrf,
      email: "admin@example.com",
      password: "admin123",
      callbackUrl: `${ORIGIN}/abonnement`,
    },
  });
  return jar;
}

const cuid = () =>
  "c" + Date.now().toString(36) + crypto.randomBytes(4).toString("hex").slice(0, 8) +
  crypto.randomBytes(4).toString("hex").slice(0, 8);

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

function summary() {
  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  return failed;
}

function context() {
  if (!existsSync(CONTEXT)) throw new Error("contexte absent : lancez d'abord la phase setup");
  return JSON.parse(readFileSync(CONTEXT, "utf8"));
}

function stripeClient() {
  const mod = require("stripe");
  const Stripe = mod.Stripe ?? mod.default ?? mod;
  return new Stripe(readEnv().STRIPE_SECRET_KEY);
}

/** Attend qu'une condition en base devienne vraie (les webhooks sont asynchrones). */
async function waitFor(fn, { timeout = 25000, interval = 500 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

/* ------------------------------------------------------------------ phases */

async function setup() {
  const db = new Database(dbPath());
  const stripe = stripeClient();
  const admin = db.prepare("SELECT id,email FROM Author WHERE email=?").get("admin@example.com");
  if (!admin) throw new Error("admin@example.com introuvable");

  // Repartir d'un état propre pour cet utilisateur.
  db.prepare("DELETE FROM Payment WHERE userId=?").run(admin.id);
  db.prepare("DELETE FROM Subscription WHERE userId=?").run(admin.id);
  db.prepare("DELETE FROM Plan WHERE slug=?").run("premium-mensuel-live");
  db.prepare("UPDATE Author SET isPremium=0, stripeCustomerId=NULL WHERE id=?").run(admin.id);

  const planId = cuid();
  db.prepare(
    `INSERT INTO Plan (id,name,slug,description,price,currency,interval,active,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
  ).run(planId, "Premium Mensuel (live)", "premium-mensuel-live", "Accès complet", 999, "EUR", "MONTH", 1);
  console.log(`plan de test créé : ${planId}`);

  const jar = await login();
  await request("GET", "/abonnement", { jar });
  const ids = actionIds();

  // 1) Session Checkout via la Server Action de l'application.
  const res = await callAction("/abonnement", ids.createCheckoutSession, [planId], jar);
  const url = (res.body.match(/https:\/\/checkout\.stripe\.com\/[^"\\\s]+/) ?? [])[0];
  check("createCheckoutSession renvoie une URL Checkout", Boolean(url), url ? url.slice(0, 58) + "…" : res.body.slice(0, 200));
  if (!url) { db.close(); return summary(); }

  const sessionId = (url.match(/cs_test_[A-Za-z0-9]+/) ?? [])[0];
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  console.log(
    `session ${session.id} : mode=${session.mode} montant=${session.amount_total} ${session.currency} statut=${session.status}`,
  );

  check("session en mode subscription", session.mode === "subscription", `mode=${session.mode}`);
  check("montant 9,99 €", session.amount_total === 999 && session.currency === "eur",
    `${session.amount_total} ${session.currency}`);
  check("métadonnées planId/userId transmises",
    session.metadata?.planId === planId && session.metadata?.userId === admin.id,
    JSON.stringify(session.metadata));
  check("success_url pointe vers /abonnement/success",
    String(session.success_url).includes("/abonnement/success?session_id="), String(session.success_url));
  check("cancel_url pointe vers /abonnement/cancel",
    String(session.cancel_url).endsWith("/abonnement/cancel"), String(session.cancel_url));

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  check("client Stripe rattaché à la session", Boolean(customerId), String(customerId));

  const row = db.prepare("SELECT stripePriceId FROM Plan WHERE id=?").get(planId);
  check("Plan.stripePriceId mémorisé (prix Stripe créé)",
    typeof row?.stripePriceId === "string" && row.stripePriceId.startsWith("price_"), String(row?.stripePriceId));
  const author = db.prepare("SELECT stripeCustomerId FROM Author WHERE id=?").get(admin.id);
  check("Author.stripeCustomerId mémorisé", author?.stripeCustomerId === customerId,
    String(author?.stripeCustomerId));

  const price = await stripe.prices.retrieve(row.stripePriceId);
  check("prix Stripe récurrent mensuel",
    price.unit_amount === 999 && price.currency === "eur" && price.recurring?.interval === "month",
    `${price.unit_amount} ${price.currency} / ${price.recurring?.interval}`);

  // 2) Portail de facturation.
  const portal = await callAction("/abonnement", ids.createBillingPortalSession, [], jar);
  const portalUrl = (portal.body.match(/https:\/\/billing\.stripe\.com\/[^"\\\s]+/) ?? [])[0];
  check("createBillingPortalSession renvoie une URL de portail", Boolean(portalUrl),
    portalUrl ? portalUrl.slice(0, 58) + "…" : portal.body.slice(0, 200));

  db.close();
  writeFileSync(CONTEXT, JSON.stringify({
    planId, userId: admin.id, customerId, priceId: row.stripePriceId, sessionId,
  }, null, 2));
  console.log(`contexte écrit dans ${CONTEXT}`);
  console.log(`\nÉtape suivante : stripe trigger checkout.session.completed ` +
    `--add checkout_session:metadata.planId=${planId} ` +
    `--add checkout_session:metadata.userId=${admin.id} ` +
    `--override checkout_session:customer=${customerId}`);
  return summary();
}

async function main() {
  const phase = process.argv[2];
  if (phase === "setup") return setup();

  if (phase === "verify-create") {
    const ctx = context();
    const db = new Database(dbPath());
    const stripe = stripeClient();

    const session = (
      await stripe.checkout.sessions.list({ customer: ctx.customerId, status: "complete", limit: 1 })
    ).data[0];
    check("session Checkout terminée retrouvée côté Stripe", Boolean(session), String(session?.id));

    const rows = await waitFor(() => {
      const r = db.prepare("SELECT * FROM Subscription WHERE userId=?").all(ctx.userId);
      return r.length ? r : null;
    });
    check("abonnement créé en base par le webhook", Boolean(rows?.length));
    check("une seule ligne d'abonnement (idempotence)", rows?.length === 1, `${rows?.length} ligne(s)`);

    const sub = rows?.[0];
    if (sub) {
      check("statut ACTIVE", sub.status === "ACTIVE", sub.status);
      check("plan et utilisateur corrects", sub.planId === ctx.planId && sub.userId === ctx.userId);
      check("session Checkout mémorisée (clé d'idempotence)", sub.stripeSessionId === session?.id,
        `${sub.stripeSessionId} / ${session?.id}`);
      check("achat unique : échéance lointaine",
        new Date(sub.currentPeriodEnd) > new Date(Date.now() + 50 * 365 * 864e5), String(sub.currentPeriodEnd));
      const author = db.prepare("SELECT isPremium FROM Author WHERE id=?").get(ctx.userId);
      check("Author.isPremium passé à vrai", author?.isPremium === 1, String(author?.isPremium));

      const payments = db.prepare("SELECT * FROM Payment WHERE subscriptionId=?").all(sub.id);
      check("règlement de l'achat unique enregistré", payments.length === 1, `${payments.length} paiement(s)`);
      const pi = typeof session?.payment_intent === "string"
        ? session.payment_intent
        : session?.payment_intent?.id;
      check("montant et intent de paiement enregistrés",
        payments[0]?.amount === session?.amount_total && (!pi || payments[0]?.stripePaymentIntentId === pi),
        `${payments[0]?.amount} / ${payments[0]?.stripePaymentIntentId}`);
    }
    db.close();
    console.log("\nIdempotence : relivrer le MÊME événement (stripe events resend <evt_...>),");
    console.log("puis relancer « verify-create » (toujours 1 seule ligne attendue).");
    console.log("Ensuite : node scripts/check-stripe-live.cjs subscribe");
    return summary();
  }

  if (phase === "subscribe") {
    const ctx = context();
    const stripe = stripeClient();
    // Abonnement RÉEL sur le client et le prix créés par l'application : Stripe
    // émet alors customer.subscription.created/updated et invoice.paid.
    let paymentMethod = "pm_card_visa";
    try {
      const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
      await stripe.paymentMethods.attach(pm.id, { customer: ctx.customerId });
      paymentMethod = pm.id;
    } catch (e) {
      console.log(`(carte de test pm_card_visa utilisée directement : ${e.message})`);
    }
    const sub = await stripe.subscriptions.create({
      customer: ctx.customerId,
      items: [{ price: ctx.priceId }],
      default_payment_method: paymentMethod,
      metadata: { planId: ctx.planId, userId: ctx.userId },
      payment_behavior: "error_if_incomplete",
    });
    console.log(`abonnement Stripe réel ${sub.id} : statut=${sub.status}`);
    const invoice = await stripe.invoices.retrieve(String(sub.latest_invoice));
    console.log(`facture ${invoice.id} : statut=${invoice.status} montant=${invoice.amount_paid} ${invoice.currency}`);
    check("abonnement Stripe actif", sub.status === "active", sub.status);
    check("facture Stripe payée", invoice.status === "paid" && invoice.amount_paid === 999,
      `${invoice.status} ${invoice.amount_paid}`);
    const raw = JSON.parse(readFileSync(CONTEXT, "utf8"));
    raw.stripeSubscriptionId = sub.id;
    writeFileSync(CONTEXT, JSON.stringify(raw, null, 2));
    console.log("Événements invoice.paid / customer.subscription.updated en route vers le webhook…");
    return 0;
  }

  if (phase === "update-sub") {
    const ctx = context();
    if (!ctx.stripeSubscriptionId) throw new Error("abonnement Stripe inconnu : lancez la phase subscribe");
    const stripe = stripeClient();
    // Modification réelle de l'abonnement : Stripe émet customer.subscription.updated.
    const updated = await stripe.subscriptions.update(ctx.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    console.log(`abonnement ${updated.id} : cancel_at_period_end=${updated.cancel_at_period_end}`);
    console.log("Événement customer.subscription.updated en route vers le webhook…");
    return 0;
  }

  if (phase === "verify-update") {
    const ctx = context();
    const db = new Database(dbPath());
    const sub = await waitFor(() =>
      db.prepare("SELECT * FROM Subscription WHERE stripeSubscriptionId=?").get(ctx.stripeSubscriptionId));
    check("ligne d'abonnement retrouvée par son identifiant Stripe", Boolean(sub),
      String(ctx.stripeSubscriptionId));
    if (sub) {
      check("identifiant conforme à l'abonnement Stripe", sub.stripeSubscriptionId === ctx.stripeSubscriptionId);
      check("statut ACTIVE conservé", sub.status === "ACTIVE", sub.status);
      check("résiliation en fin de période enregistrée", sub.cancelAtPeriodEnd === 1, String(sub.cancelAtPeriodEnd));
      // La période provient désormais de Stripe (1 mois) et non plus de la
      // valeur par défaut appliquée lors de l'achat unique.
      const days = (new Date(sub.currentPeriodEnd) - Date.now()) / 864e5;
      check("période de facturation issue de Stripe (≈ 1 mois)", days > 20 && days < 40, `${days.toFixed(1)} jours`);
      const author = db.prepare("SELECT isPremium FROM Author WHERE id=?").get(ctx.userId);
      check("Author.isPremium toujours vrai", author?.isPremium === 1, String(author?.isPremium));
    }
    db.close();
    console.log(`\nÉtape suivante (résiliation immédiate) : node scripts/check-stripe-live.cjs cancel-sub`);
    return summary();
  }

  if (phase === "cancel-sub") {
    const ctx = context();
    if (!ctx.stripeSubscriptionId) throw new Error("abonnement Stripe inconnu : lancez la phase subscribe");
    const stripe = stripeClient();
    const canceled = await stripe.subscriptions.cancel(ctx.stripeSubscriptionId);
    console.log(`abonnement ${canceled.id} résilié (statut ${canceled.status})`);
    console.log("Événement customer.subscription.deleted en route vers le webhook…");
    return 0;
  }

  if (phase === "verify-invoice") {
    const ctx = context();
    const db = new Database(dbPath());
    // Ligne visée : celle rattachée à l'abonnement Stripe réel.
    const sub = await waitFor(() =>
      db.prepare("SELECT * FROM Subscription WHERE stripeSubscriptionId=?").get(ctx.stripeSubscriptionId));
    check("abonnement Stripe rattaché à une ligne en base", Boolean(sub),
      String(ctx.stripeSubscriptionId));

    const pay = sub
      ? await waitFor(() =>
          db.prepare("SELECT * FROM Payment WHERE subscriptionId=? ORDER BY createdAt DESC").get(sub.id))
      : null;
    check("paiement enregistré par le webhook", Boolean(pay));
    if (pay) {
      check("statut SUCCEEDED", pay.status === "SUCCEEDED", pay.status);
      check("montant cohérent avec la facture", Number(pay.amount) === 999, String(pay.amount));
      check("devise EUR", pay.currency === "EUR", pay.currency);
      check("date de paiement renseignée", Boolean(pay.paidAt), String(pay.paidAt));
      check("identifiant de facture Stripe enregistré (idempotence)",
        typeof pay.stripeInvoiceId === "string" && pay.stripeInvoiceId.startsWith("in_"),
        String(pay.stripeInvoiceId));
      check("identifiant d'intent de paiement Stripe enregistré",
        typeof pay.stripePaymentIntentId === "string" && pay.stripePaymentIntentId.startsWith("pi_"),
        String(pay.stripePaymentIntentId));
      check("abonnement toujours ACTIVE", sub?.status === "ACTIVE", String(sub?.status));
      console.log(`   période courante jusqu'au ${sub?.currentPeriodEnd}`);
    }
    db.close();
    console.log(`\nÉtape suivante : node scripts/check-stripe-live.cjs update-sub`);
    return summary();
  }

  if (phase === "verify-delete") {
    const ctx = context();
    const db = new Database(dbPath());
    const sub = await waitFor(() => {
      const row = db.prepare("SELECT * FROM Subscription WHERE stripeSubscriptionId=?").get(ctx.stripeSubscriptionId);
      return row && row.status === "CANCELED" ? row : null;
    });
    check("abonnement passé à CANCELED par le webhook", Boolean(sub));
    if (sub) {
      check("date de résiliation renseignée", Boolean(sub.canceledAt), String(sub.canceledAt));
      const author = db.prepare("SELECT isPremium FROM Author WHERE id=?").get(ctx.userId);
      check("Author.isPremium repassé à faux", author?.isPremium === 0, String(author?.isPremium));
    }
    db.close();
    return summary();
  }

  if (phase === "replay") {
    // Relivraison du MÊME événement : le corps est l'événement réel récupéré
    // chez Stripe, signé avec le secret du webhook selon le schéma documenté
    // (HMAC-SHA256 de « <timestamp>.<corps> »). Cela reproduit exactement une
    // relivraison Stripe (qui est « at least once »).
    const eventId = process.argv[3];
    if (!eventId) throw new Error("usage : ... replay <evt_...>");
    const stripe = stripeClient();
    const event = await stripe.events.retrieve(eventId);
    check("événement Stripe récupéré", event?.id === eventId, String(event?.id));

    const payload = JSON.stringify(event);
    const secret = readEnv().STRIPE_WEBHOOK_SECRET;
    const signature = (timestamp) =>
      `t=${timestamp},v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;

    const post = (timestamp) => {
      const body = Buffer.from(payload);
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: HOST, port: PORT, path: "/api/webhooks/stripe", method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": body.length,
              "stripe-signature": signature(timestamp),
            },
          },
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
    };

    const now = Math.floor(Date.now() / 1000);
    const first = await post(now);
    const second = await post(now + 1);
    check("relivraison 1 acceptée (signature valide)", first.status === 200, `${first.status} ${first.body.slice(0, 80)}`);
    check("relivraison 2 acceptée (signature valide)", second.status === 200, `${second.status} ${second.body.slice(0, 80)}`);
    console.log(`événement ${event.type} relivré deux fois avec une signature valide.`);
    console.log("Relancez « verify-create » : le nombre de lignes et de paiements ne doit pas changer.");
    return summary();
  }

  if (phase === "check-backoffice") {
    // Chaîne complète : abonnement Stripe actif → tableau de bord backoffice.
    // Les valeurs affichées sont comparées à celles calculées depuis la base
    // (mêmes règles que subscription-utils.ts).
    const db = new Database(dbPath());
    const rows = db
      .prepare(
        `SELECT s.status AS status, p.price AS price, p.interval AS interval
         FROM Subscription s JOIN Plan p ON p.id = s.planId`,
      )
      .all();
    const active = rows.filter((r) => r.status === "ACTIVE");
    const mrrCents = active.reduce(
      (total, r) =>
        total + (r.interval === "MONTH" ? r.price : r.interval === "YEAR" ? Math.round(r.price / 12) : 0),
      0,
    );
    const arrCents = active.reduce(
      (total, r) => total + (r.interval === "MONTH" ? r.price * 12 : r.interval === "YEAR" ? r.price : 0),
      0,
    );
    const totalPaidCents = db
      .prepare("SELECT amount, status FROM Payment")
      .all()
      .filter((p) => p.status === "SUCCEEDED")
      .reduce((total, p) => total + p.amount, 0);
    db.close();

    const euros = (cents) => (cents / 100).toFixed(2).replace(".", ",");
    const expectedMrr = euros(mrrCents);
    const expectedArr = euros(arrCents);
    const expectedPaid = euros(totalPaidCents);
    console.log(
      `attendu d'après la base : ${active.length} abonnement(s) actif(s), MRR ${expectedMrr} €, ` +
        `ARR ${expectedArr} €, encaissé ${expectedPaid} €`,
    );

    const jar = await login();
    const page = await request("GET", "/backoffice", { jar });
    check("GET /backoffice -> 200", page.status === 200, `status=${page.status}`);
    const html = page.body.replace(/<!--.*?-->/g, "");

    const cardValue = (label) => {
      const index = html.indexOf(label);
      return index > -1 ? html.slice(index, index + 400) : null;
    };

    const activeCard = cardValue("Abonnements actifs");
    check(`compteur d'abonnements actifs affiché = ${active.length}`,
      activeCard !== null && new RegExp(`>\\s*${active.length}\\s*<`).test(activeCard),
      activeCard ? activeCard.slice(0, 160).replace(/\s+/g, " ") : "carte absente");

    for (const [label, expected] of [
      ["Revenu mensuel récurrent (MRR)", expectedMrr],
      ["Revenu annuel récurrent (ARR)", expectedArr],
      ["Total encaissé", expectedPaid],
    ]) {
      const card = cardValue(label);
      check(`${label} affiché = ${expected} €`,
        card !== null && new RegExp(expected.replace(".", "\\.") + "\\s*€").test(card),
        card ? card.slice(0, 200).replace(/\s+/g, " ") : "carte absente");
    }
    return summary();
  }

  if (phase === "cleanup") {
    const ctx = context();
    const db = new Database(dbPath());
    db.prepare("DELETE FROM Payment WHERE userId=?").run(ctx.userId);
    db.prepare("DELETE FROM Subscription WHERE userId=?").run(ctx.userId);
    db.prepare("DELETE FROM Plan WHERE id=?").run(ctx.planId);
    db.prepare("UPDATE Author SET isPremium=0, stripeCustomerId=NULL WHERE id=?").run(ctx.userId);
    db.close();
    unlinkSync(CONTEXT);

    // Ménage côté Stripe (mode test) : produit/prix et client de test.
    const stripe = stripeClient();
    try {
      if (ctx.stripeSubscriptionId) {
        await stripe.subscriptions.cancel(ctx.stripeSubscriptionId).catch(() => {});
      }
      if (ctx.priceId) {
        const price = await stripe.prices.retrieve(ctx.priceId);
        const productId = typeof price.product === "string" ? price.product : price.product?.id;
        // Un prix ne peut qu'être archivé (jamais supprimé), et Stripe refuse
        // de supprimer un produit portant un prix créé par l'API : on archive
        // donc les deux.
        await stripe.prices.update(ctx.priceId, { active: false });
        if (productId) await stripe.products.update(productId, { active: false });
        console.log("produit et prix de test archivés.");
      }
      if (ctx.customerId) await stripe.customers.del(ctx.customerId);
      console.log("client Stripe de test supprimé.");
    } catch (e) {
      console.log(`(ménage Stripe partiel : ${e.message})`);
    }
    console.log("données de test Stripe supprimées (plan, abonnements, paiements, stripeCustomerId).");
    return 0;
  }

  console.log("usage : node scripts/check-stripe-live.cjs <setup|verify-create|replay <evt_id>|subscribe|verify-invoice|update-sub|verify-update|cancel-sub|verify-delete|cleanup>");
  return 1;
}

main().then((failed) => process.exit(failed === 0 ? 0 : 1)).catch((e) => {
  console.error("ERREUR:", e.stack);
  process.exit(1);
});
