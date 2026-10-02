/**
 * Vérification du WP7e — consolidation + administration des abonnements.
 * Exécution : node scripts/check-wp7e.cjs   (PORT=3002 pour ce projet)
 *
 * Prérequis : serveur de dev sur PORT, tunnel `stripe listen` vers ce port, et
 * un plan Annuel avec prix Stripe.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

const env = {};
for (const line of readFileSync(path.resolve(".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (m) env[m[1]] = m[2];
}

const StripeModule = require("stripe");
const Stripe = StripeModule.Stripe ?? StripeModule.default ?? StripeModule;
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const db = new Database(
  path.resolve((process.env.DATABASE_URL ?? env.DATABASE_URL).replace(/^file:(\/\/)?/, "")),
);

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
    has(name) {
      return Boolean(store.get(name));
    },
  };
}

function request(method, urlPath, { jar, form, headers: extra, body: rawBody } = {}) {
  const body = form ? new URLSearchParams(form).toString() : (rawBody ?? null);
  const headers = { origin: ORIGIN, referer: `${ORIGIN}${urlPath}`, ...(extra ?? {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (body && !headers["content-type"]) headers["content-type"] = "application/x-www-form-urlencoded";
  if (body) headers["content-length"] = Buffer.byteLength(body);
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

function submitActionIdForm(jar, pagePath, actionId, fields) {
  const boundary = "----WP7E" + crypto.randomBytes(8).toString("hex");
  const parts = [];
  for (const [name, value] of Object.entries({ ...fields, [`$ACTION_ID_${actionId}`]: "" })) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: pagePath,
        method: "POST",
        headers: {
          cookie: jar.header(),
          origin: ORIGIN,
          referer: `${ORIGIN}${pagePath}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": payload.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          jar.absorb(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function actionIdForField(html, fieldName) {
  const forms = html.split(/<form/i).slice(1);
  const form = forms.find((chunk) => chunk.includes(`name="${fieldName}"`));
  if (!form) return null;
  const match = form.match(/name="\$ACTION_ID_([0-9a-f]+)"/);
  return match ? match[1] : null;
}

function clientActionId(pagePath, exportedName) {
  const manifestPath = path.resolve(`.next/server/app${pagePath}/page/server-reference-manifest.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    if (entry?.exportedName === exportedName) return id;
  }
  return null;
}

function callAction(jar, pagePath, actionId, args = []) {
  return request("POST", pagePath, {
    jar,
    body: JSON.stringify(args),
    headers: { "next-action": actionId, "content-type": "text/plain;charset=UTF-8" },
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
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/` },
  });
  return jar;
}

const sessionOf = async (jar) =>
  JSON.parse((await request("GET", "/api/auth/session", { jar })).body || "{}");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/* ------------------------------------------------------------------- tests */

async function main() {
  const admin = db.prepare("SELECT id, name, email FROM Author WHERE email = ?").get("admin@example.com");
  const journalist = db.prepare("SELECT id, email FROM Author WHERE email = ?").get("journalist@example.com");
  const editor = db.prepare("SELECT id, email FROM Author WHERE email = ?").get("editor@example.com");
  const annualPlan = db.prepare("SELECT id, stripePriceId FROM Plan WHERE interval = 'YEAR'").get();
  const lifetimePlan = db.prepare("SELECT id FROM Plan WHERE interval = 'LIFETIME'").get();
  if (!admin || !journalist || !editor) throw new Error("auteurs de test manquants");
  if (!annualPlan?.stripePriceId) throw new Error("plan Annuel sans prix Stripe");

  /* ---------------------------------------------- Partie A : consolidation */

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'SubscriptionEvent'")
    .get();
  check("table SubscriptionEvent créée", Boolean(tables));

  const adminJar = await login("admin@example.com", "admin123");
  const adminSession = await sessionOf(adminJar);
  check("session : role exposé", adminSession?.user?.role === "ADMIN", String(adminSession?.user?.role));
  check("session : isPremium exposé (abonné)", adminSession?.user?.isPremium === true,
    String(adminSession?.user?.isPremium));

  const editorJar = await login("editor@example.com", "password123");
  const editorSession = await sessionOf(editorJar);
  check("session : isPremium faux pour un non-abonné", editorSession?.user?.isPremium === false,
    String(editorSession?.user?.isPremium));

  const actionsSource = readFileSync(
    path.resolve("src/app/mon-compte/actions.ts"),
    "utf8",
  );
  const userMenuSource = readFileSync(path.resolve("src/components/UserMenu.tsx"), "utf8");
  check("getViewerSummary supprimée des actions", !actionsSource.includes("getViewerSummary"));
  check("UserMenu lit la session (plus de Server Action)",
    userMenuSource.includes("/api/auth/session") && !userMenuSource.includes("getViewerSummary"));

  const home = await request("GET", "/");
  const scripts = [...new Set(
    [...home.body.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]),
  )];
  let bundle = "";
  for (const src of scripts) bundle += (await request("GET", src)).body;
  check("bundle client : « Mon compte » et badge « Premium »",
    bundle.includes("Mon compte") && bundle.includes("Premium"));

  // Rafraîchissement du jeton : on simule un paiement (isPremium passe à vrai en
  // base) et on attend que la session le reflète, sans reconnexion.
  const startedAt = Date.now();
  db.prepare("UPDATE Author SET isPremium = 1 WHERE id = ?").run(editor.id);
  let refreshed = false;
  for (let i = 0; i < 16 && !refreshed; i += 1) {
    const value = (await sessionOf(editorJar))?.user?.isPremium;
    if (value === true) refreshed = true;
    else await sleep(5000);
  }
  db.prepare("UPDATE Author SET isPremium = 0 WHERE id = ?").run(editor.id);
  check("jeton rafraîchi sans reconnexion (badge Premium)",
    refreshed, `${Math.round((Date.now() - startedAt) / 1000)} s`);

  // Paiement unique : facture demandée à Stripe
  const checkoutActionId = clientActionId("/abonnement", "createCheckoutSession");
  check("action createCheckoutSession localisée", Boolean(checkoutActionId));
  let sessionId = null;
  if (checkoutActionId) {
    const result = await callAction(adminJar, "/abonnement", checkoutActionId, [lifetimePlan.id]);
    const url = (result.body.match(/https:\/\/checkout\.stripe\.com\/[^"\\\s]+/) ?? [])[0];
    sessionId = (url ?? "").match(/cs_test_[A-Za-z0-9]+/)?.[0] ?? null;
    check("session Checkout d'achat à vie créée", Boolean(sessionId), String(url).slice(0, 50));
    if (sessionId) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
      check("achat à vie : invoice_creation activée",
        checkoutSession.invoice_creation?.enabled === true,
        JSON.stringify(checkoutSession.invoice_creation));
      await stripe.checkout.sessions.expire(sessionId).catch(() => {});
    }
  }

  /* -------------------------------- Abonnement Stripe réel (journal + admin) */

  let customerId = null;
  let subscriptionId = null;
  let subscriptionRowId = null;
  try {
    db.prepare("DELETE FROM Payment WHERE userId = ?").run(journalist.id);
    db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId IN (SELECT id FROM Subscription WHERE userId = ?)").run(journalist.id);
    db.prepare("DELETE FROM Subscription WHERE userId = ?").run(journalist.id);
    db.prepare("UPDATE Author SET isPremium = 0, stripeCustomerId = NULL WHERE id = ?").run(journalist.id);

    const customer = await stripe.customers.create({
      email: journalist.email,
      name: "Journaliste Test",
      metadata: { userId: journalist.id, purpose: "check-wp7e" },
    });
    customerId = customer.id;
    db.prepare("UPDATE Author SET stripeCustomerId = ? WHERE id = ?").run(customerId, journalist.id);

    const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
    await stripe.paymentMethods.attach(pm.id, { customer: customerId });
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: annualPlan.stripePriceId }],
      default_payment_method: pm.id,
      metadata: { planId: annualPlan.id, userId: journalist.id },
      payment_behavior: "error_if_incomplete",
    });
    subscriptionId = subscription.id;

    for (let i = 0; i < 25; i += 1) {
      const row = db.prepare("SELECT id, status FROM Subscription WHERE stripeSubscriptionId = ?").get(subscriptionId);
      if (row?.status === "ACTIVE") {
        subscriptionRowId = row.id;
        break;
      }
      await sleep(1000);
    }
    check("abonnement Stripe réel actif en base", Boolean(subscriptionRowId), String(subscriptionRowId));

    const eventsFor = (id) =>
      db.prepare("SELECT type FROM SubscriptionEvent WHERE subscriptionId = ? ORDER BY createdAt").all(id).map((e) => e.type);
    check("journal : événement CREATED", eventsFor(subscriptionRowId).includes("CREATED"),
      eventsFor(subscriptionRowId).join(", "));

    // Espace abonné : timeline réelle
    const journalistJar = await login("journalist@example.com", "password123");
    const detailPage = await request("GET", "/mon-compte/abonnement", { jar: journalistJar });
    check("espace abonné : historique d'événements réels",
      detailPage.body.includes("Historique des événements") &&
        detailPage.body.includes("Abonnement créé"));

    // Annulation par un administrateur (formulaire de confirmation)
    const adminDetail = await request("GET", `/backoffice/subscriptions/${subscriptionRowId}?confirmer=annuler`, { jar: adminJar });
    check("admin : page de détail -> 200", adminDetail.status === 200, `status=${adminDetail.status}`);
    check("admin : lien « Voir dans Stripe »",
      adminDetail.body.includes("dashboard.stripe.com/test/subscriptions/"));
    check("admin : timeline des événements", adminDetail.body.includes("Historique des événements"));
    const cancelActionId = actionIdForField(adminDetail.body, "subscriptionId");
    check("admin : formulaire d'annulation détecté", Boolean(cancelActionId));
    if (cancelActionId) {
      const cancelResult = await submitActionIdForm(
        adminJar,
        `/backoffice/subscriptions/${subscriptionRowId}`,
        cancelActionId,
        { subscriptionId: subscriptionRowId },
      );
      await sleep(1500);
      check("admin : annulation effective côté Stripe",
        (await stripe.subscriptions.retrieve(subscriptionId)).cancel_at_period_end === true);
      check("admin : redirection avec confirmation",
        String(cancelResult.location).includes("resultat=annule"), String(cancelResult.location));
      check("journal : événement CANCELED (admin)", eventsFor(subscriptionRowId).includes("CANCELED"),
        eventsFor(subscriptionRowId).join(", "));
    }

    // Réactivation par l'abonné (action client du WP7d)
    const reactivateId = clientActionId("/mon-compte", "reactivateSubscription");
    check("action reactivateSubscription localisée", Boolean(reactivateId));
    if (reactivateId) {
      await callAction(journalistJar, "/mon-compte", reactivateId);
      await sleep(1500);
      check("réactivation effective côté Stripe",
        (await stripe.subscriptions.retrieve(subscriptionId)).cancel_at_period_end === false);
      check("journal : événement REACTIVATED", eventsFor(subscriptionRowId).includes("REACTIVATED"),
        eventsFor(subscriptionRowId).join(", "));
    }

    // Remboursement d'un paiement par un administrateur
    const payment = db
      .prepare("SELECT id, stripePaymentIntentId FROM Payment WHERE userId = ? AND status = 'SUCCEEDED' LIMIT 1")
      .get(journalist.id);
    check("paiement de l'abonnement enregistré", Boolean(payment), String(payment?.id));
    if (payment) {
      const refundPage = await request(
        "GET",
        `/backoffice/subscriptions/${subscriptionRowId}?confirmer=rembourser&paiement=${payment.id}`,
        { jar: adminJar },
      );
      const refundActionId = actionIdForField(refundPage.body, "paymentId");
      check("admin : formulaire de remboursement détecté", Boolean(refundActionId));
      if (refundActionId) {
        const refundResult = await submitActionIdForm(
          adminJar,
          `/backoffice/subscriptions/${subscriptionRowId}`,
          refundActionId,
          { paymentId: payment.id },
        );
        await sleep(500);
        check("admin : paiement marqué remboursé",
          db.prepare("SELECT status FROM Payment WHERE id = ?").get(payment.id)?.status === "REFUNDED");
        check("admin : redirection avec confirmation",
          String(refundResult.location).includes("resultat=rembourse"), String(refundResult.location));
        check("journal : événement REFUNDED", eventsFor(subscriptionRowId).includes("REFUNDED"),
          eventsFor(subscriptionRowId).join(", "));
        const refunds = await stripe.refunds.list({ payment_intent: payment.stripePaymentIntentId, limit: 1 });
        check("remboursement créé côté Stripe", refunds.data.length === 1, String(refunds.data[0]?.id));
      }
    }

    /* ------------------------------------------- Liste, filtres, pagination */

    const list = await request("GET", "/backoffice/subscriptions?tab=subscriptions", { jar: adminJar });
    check("admin : liste des abonnements -> 200", list.status === 200, `status=${list.status}`);
    for (const [label, marker] of [
      ["filtre statut", 'name="statut"'],
      ["filtre plan", 'name="plan"'],
      ["recherche e-mail", 'name="q"'],
      ["colonne MRR", "MRR"],
      ["action voir le détail", "Voir le détail"],
      ["action annuler", ">Annuler<"],
    ]) {
      check(`liste : ${label}`, list.body.includes(marker));
    }

    const filteredByEmail = await request(
      "GET",
      "/backoffice/subscriptions?tab=subscriptions&q=journalist%40example.com",
      { jar: adminJar },
    );
    check("liste : recherche par e-mail", filteredByEmail.body.includes("journalist@example.com"));
    const filteredEmpty = await request(
      "GET",
      "/backoffice/subscriptions?tab=subscriptions&q=personne%40nulle-part.test",
      { jar: adminJar },
    );
    check("liste : recherche sans résultat",
      filteredEmpty.body.includes("Aucun abonnement ne correspond"));
    const filteredStatus = await request(
      "GET",
      "/backoffice/subscriptions?tab=subscriptions&statut=CANCELED",
      { jar: adminJar },
    );
    check("liste : filtre par statut", filteredStatus.body.includes("Annulé"));

    // Pagination : 21 abonnements de test supplémentaires
    const bulkIds = [];
    const clearBulk = () => {
      for (const id of bulkIds) {
        db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId = ?").run(id);
        db.prepare("DELETE FROM Subscription WHERE id = ?").run(id);
      }
      bulkIds.length = 0;
    };
    try {
      const now = new Date().toISOString();
      const end = new Date(Date.now() + 30 * 864e5).toISOString();
      const insert = db.prepare(
        `INSERT INTO Subscription (id, userId, planId, status, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt)
         VALUES (?, ?, ?, 'ACTIVE', ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      );
      for (let i = 0; i < 21; i += 1) {
        const id = "cbulk" + crypto.randomBytes(8).toString("hex");
        bulkIds.push(id);
        insert.run(id, editor.id, annualPlan.id, now, end);
      }
      const stripTags = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const page1 = await request(
        "GET",
        "/backoffice/subscriptions?tab=subscriptions&statut=ACTIVE&page=1",
        { jar: adminJar },
      );
      check("pagination : compteur et numéro de page",
        /page 1 sur \d+/.test(stripTags(page1.body)),
        (stripTags(page1.body).match(/page \d+ sur \d+/) ?? ["?"])[0]);
      check("pagination : lien « Page suivante »", page1.body.includes("Page suivante →"));
      const page2 = await request(
        "GET",
        "/backoffice/subscriptions?tab=subscriptions&statut=ACTIVE&page=2",
        { jar: adminJar },
      );
      check("pagination : page 2 accessible",
        /page 2 sur \d+/.test(stripTags(page2.body)),
        (stripTags(page2.body).match(/page \d+ sur \d+/) ?? ["?"])[0]);
      check("pagination : lien « Page précédente »", page2.body.includes("Page précédente"));
    } finally {
      clearBulk();
    }

    /* ---------------------------------------------------------- Métriques */

    const monthStart = new Date();
    const monthStartIso = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1)).toISOString();
    const expectedNew = db
      .prepare("SELECT COUNT(*) AS c FROM Subscription WHERE createdAt >= ?")
      .get(monthStartIso).c;
    const dashboard = await request("GET", "/backoffice", { jar: adminJar });
    check("backoffice : carte « Nouveaux abonnés (ce mois) »",
      dashboard.body.includes("Nouveaux abonnés (ce mois)"));
    check("backoffice : carte « Taux de churn (ce mois) »",
      dashboard.body.includes("Taux de churn (ce mois)"));
    const newCard = dashboard.body.slice(dashboard.body.indexOf("Nouveaux abonnés (ce mois)"));
    check(`backoffice : nouveaux abonnés = ${expectedNew}`,
      new RegExp(`>\\s*${expectedNew}\\s*<`).test(newCard.slice(0, 300)),
      newCard.slice(0, 160).replace(/\s+/g, " "));
  } finally {
    if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId).catch(() => {});
    if (subscriptionRowId) {
      db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId = ?").run(subscriptionRowId);
    }
    db.prepare("DELETE FROM Payment WHERE userId = ?").run(journalist.id);
    db.prepare("DELETE FROM Subscription WHERE userId = ?").run(journalist.id);
    db.prepare("UPDATE Author SET isPremium = 0, stripeCustomerId = NULL WHERE id = ?").run(journalist.id);
    if (customerId) await stripe.customers.del(customerId).catch(() => {});
  }

  db.close();
  console.log("\n   (données de test nettoyées)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
