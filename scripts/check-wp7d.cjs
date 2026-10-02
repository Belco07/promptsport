/**
 * Vérification du WP7d — espace abonné.
 * Exécution : node scripts/check-wp7d.cjs   (PORT=3002 pour ce projet)
 *
 * Le contrôle :
 *  - vérifie la protection des pages et l'affichage des quatre sections ;
 *  - rejoue réellement les formulaires « progressifs » du profil et du mot de
 *    passe (champ caché $ACTION_ID_<id>) ;
 *  - crée un abonnement Stripe RÉEL pour le compte journaliste afin de tester
 *    « Annuler l'abonnement » et « Réactiver » (actions appelées depuis le
 *    client : protocole Next-Action) ;
 *  - nettoie systématiquement ses données (base + Stripe).
 *
 * Prérequis : serveur de dev sur PORT et tunnel `stripe listen` vers ce port.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const bcrypt = require("bcryptjs");
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

const dbPath = path.resolve(
  (process.env.DATABASE_URL ?? env.DATABASE_URL).replace(/^file:(\/\/)?/, ""),
);
const db = new Database(dbPath);

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
  if (body && !headers["content-type"]) {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
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

function multipart(fields, boundary) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

/** Formulaire « progressif » : champ caché $ACTION_ID_<id>. */
function submitActionIdForm(jar, pagePath, actionId, fields) {
  const boundary = "----WP7D" + crypto.randomBytes(8).toString("hex");
  const payload = multipart({ ...fields, [`$ACTION_ID_${actionId}`]: "" }, boundary);
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

/**
 * Identifiant d'action du formulaire contenant un champ donné : on découpe le
 * HTML par <form> pour ne pas confondre les formulaires entre eux (le menu de
 * navigation contient lui aussi une action de déconnexion).
 */
function actionIdForField(html, fieldName) {
  const forms = html.split(/<form/i).slice(1);
  const form = forms.find((chunk) => chunk.includes(`name="${fieldName}"`));
  if (!form) return null;
  const match = form.match(/name="\$ACTION_ID_([0-9a-f]+)"/);
  return match ? match[1] : null;
}

/** Identifiant d'une Server Action appelée depuis le client (manifeste Next). */
function clientActionId(exportedName) {
  const manifestPath = path.resolve(
    ".next/server/app/mon-compte/page/server-reference-manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    if (entry?.exportedName === exportedName) return id;
  }
  return null;
}

/** Appel direct d'une Server Action (protocole Next-Action). */
function callAction(jar, pagePath, actionId, args = []) {
  const body = JSON.stringify(args);
  return request("POST", pagePath, {
    jar,
    body,
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
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/mon-compte` },
  });
  return jar;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const euro = (cents, currency = "EUR") =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100);

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/* ------------------------------------------------------------------- tests */

async function main() {
  const admin = db.prepare("SELECT id, name, email, passwordHash FROM Author WHERE email = ?").get("admin@example.com");
  const journalist = db.prepare("SELECT id, email, passwordHash FROM Author WHERE email = ?").get("journalist@example.com");
  const editor = db.prepare("SELECT id FROM Author WHERE email = ?").get("editor@example.com");
  const annualPlan = db.prepare("SELECT id, stripePriceId FROM Plan WHERE interval = 'YEAR'").get();
  if (!admin || !journalist || !editor) throw new Error("auteurs de test manquants");
  if (!annualPlan?.stripePriceId) throw new Error("plan Annuel sans prix Stripe (lancez d'abord un paiement de test)");

  // 1) Schéma
  const paymentColumns = db.prepare("PRAGMA table_info(Payment)").all().map((c) => c.name);
  check("Payment.invoiceUrl existe", paymentColumns.includes("invoiceUrl"));

  // 2) Navigation publique
  const home = await request("GET", "/");
  check("GET / -> 200", home.status === 200, `status=${home.status}`);
  check("navigation : état neutre dans le HTML serveur",
    !home.body.includes(">Se connecter<") && !home.body.includes(">Se déconnecter<"));
  const scripts = [...new Set(
    [...home.body.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map((m) => m[1]),
  )];
  let bundle = "";
  for (const src of scripts) bundle += (await request("GET", src)).body;
  check("bundle client : « Mon compte »", bundle.includes("Mon compte"));
  check("bundle client : « Se déconnecter »", bundle.includes("Se déconnecter"));
  check("bundle client : badge « Premium »", bundle.includes("Premium"));

  const loginPage = await request("GET", "/login");
  check("navigation : « Se connecter » sur la page de connexion",
    loginPage.status === 200 && loginPage.body.includes("Se connecter"));

  // 3) Protection des pages
  const anonAccount = await request("GET", "/mon-compte");
  check("visiteur : /mon-compte redirige vers /login",
    (anonAccount.status === 307 || anonAccount.status === 302) &&
      String(anonAccount.location).includes("/login"),
    `${anonAccount.status} ${anonAccount.location}`);
  const anonSub = await request("GET", "/mon-compte/abonnement");
  check("visiteur : /mon-compte/abonnement redirige vers /login",
    (anonSub.status === 307 || anonSub.status === 302) && String(anonSub.location).includes("/login"),
    `${anonSub.status} ${anonSub.location}`);

  // 4) Sans abonnement (compte éditeur)
  const editorJar = await login("editor@example.com", "password123");
  const editorPage = await request("GET", "/mon-compte", { jar: editorJar });
  check("sans abonnement : message « Vous n'avez pas d'abonnement actif »",
    editorPage.body.includes("Vous n&#x27;avez pas d&#x27;abonnement actif"));
  check("sans abonnement : bouton « Voir les offres » vers /abonnement",
    editorPage.body.includes('href="/abonnement"') && editorPage.body.includes("Voir les offres"));

  // 5) Abonné actif : le compte admin possède un plan à vie ACTIVE
  const adminJar = await login("admin@example.com", "admin123");
  const account = await request("GET", "/mon-compte", { jar: adminJar });
  check("abonné : GET /mon-compte -> 200", account.status === 200, `status=${account.status}`);
  for (const [label, marker] of [
    ["section Profil", "Profil"],
    ["section Abonnement", "Abonnement"],
    ["section Historique des paiements", "Historique des paiements"],
    ["section Sécurité", "Sécurité"],
  ]) {
    check(`page : ${label}`, account.body.includes(marker));
  }
  check("profil : nom et e-mail affichés",
    account.body.includes(admin.name) && account.body.includes(admin.email));
  // La formule affichée est celle de l'abonnement actif en base : on la lit au
  // lieu de figer le plan à vie (d'autres suites peuvent créer un abonnement).
  const activePlan = db
    .prepare(
      `SELECT p.name AS name, p.price AS price FROM Subscription s JOIN Plan p ON p.id = s.planId
       WHERE s.userId = ? AND s.status IN ('ACTIVE', 'TRIALING') ORDER BY s.createdAt DESC LIMIT 1`,
    )
    .get(admin.id);
  const activePrice = activePlan ? (activePlan.price / 100).toFixed(2).replace(".", ",") : null;
  check(
    "abonnement : formule et prix affichés",
    Boolean(activePlan) && account.body.includes(activePlan.name) && account.body.includes(activePrice),
    activePlan ? `${activePlan.name} / ${activePrice}` : "aucun abonnement actif",
  );
  check("abonnement : bouton « Gérer mon abonnement »",
    account.body.includes("Gérer mon abonnement"));
  check("historique : lien « Voir la facture » (facture Stripe hébergée)",
    account.body.includes("Voir la facture"));
  const invoiceUrl = db
    .prepare("SELECT invoiceUrl FROM Payment WHERE userId = ? AND invoiceUrl IS NOT NULL LIMIT 1")
    .get(admin.id)?.invoiceUrl;
  check("historique : URL de facture enregistrée en base",
    typeof invoiceUrl === "string" && invoiceUrl.includes("stripe.com"), String(invoiceUrl));

  // 6) Modification du nom (formulaire « progressif »)
  const newName = `Admin Test ${Date.now().toString(36).slice(-4)}`;
  const nameActionId = actionIdForField(account.body, "name");
  check("formulaire de profil : action détectée", Boolean(nameActionId));
  if (nameActionId) {
    await submitActionIdForm(adminJar, "/mon-compte", nameActionId, {
      name: newName,
      email: admin.email,
    });
    await sleep(500);
    const stored = db.prepare("SELECT name FROM Author WHERE id = ?").get(admin.id)?.name;
    check("profil : nom persisté en base", stored === newName, String(stored));

    const renamed = await request("GET", "/mon-compte?profil=maj", { jar: adminJar });
    check("profil : message de confirmation affiché",
      renamed.body.includes("Votre nom a bien été mis à jour"));

    // Retour au nom d'origine.
    await submitActionIdForm(adminJar, "/mon-compte", nameActionId, {
      name: admin.name,
      email: admin.email,
    });
  }

  // 7) Mot de passe
  const passwordActionId = actionIdForField(account.body, "newPassword");
  check("formulaire de mot de passe : action détectée", Boolean(passwordActionId));
  if (passwordActionId) {
    const wrong = await submitActionIdForm(adminJar, "/mon-compte", passwordActionId, {
      currentPassword: "mauvais-mot-de-passe",
      newPassword: "NouveauMotDePasse123",
      confirmPassword: "NouveauMotDePasse123",
    });
    const stillOld = await bcrypt.compare(
      "admin123",
      db.prepare("SELECT passwordHash FROM Author WHERE id = ?").get(admin.id).passwordHash,
    );
    check("mot de passe : mauvais mot de passe actuel refusé",
      String(wrong.location).includes("erreur=motdepasse-actuel") && stillOld,
      `${wrong.status} ${wrong.location}`);

    const mismatch = await submitActionIdForm(adminJar, "/mon-compte", passwordActionId, {
      currentPassword: "admin123",
      newPassword: "NouveauMotDePasse123",
      confirmPassword: "AutreChose123",
    });
    check("mot de passe : confirmation différente refusée",
      String(mismatch.location).includes("erreur=motdepasse-different"),
      `${mismatch.status} ${mismatch.location}`);

    const changed = await submitActionIdForm(adminJar, "/mon-compte", passwordActionId, {
      currentPassword: "admin123",
      newPassword: "NouveauMotDePasse123",
      confirmPassword: "NouveauMotDePasse123",
    });
    const newHash = db.prepare("SELECT passwordHash FROM Author WHERE id = ?").get(admin.id).passwordHash;
    check("mot de passe : changement effectif",
      String(changed.location).includes("motdepasse=maj") &&
        (await bcrypt.compare("NouveauMotDePasse123", newHash)),
      `${changed.status} ${changed.location}`);

    const jarWithNewPassword = await login("admin@example.com", "NouveauMotDePasse123");
    check("mot de passe : connexion possible avec le nouveau",
      jarWithNewPassword.has("authjs.session-token"));

    // Restauration du mot de passe d'origine.
    const restoreJar = await login("admin@example.com", "NouveauMotDePasse123");
    const restorePage = await request("GET", "/mon-compte", { jar: restoreJar });
    const restoreActionId = actionIdForField(restorePage.body, "newPassword");
    await submitActionIdForm(restoreJar, "/mon-compte", restoreActionId, {
      currentPassword: "NouveauMotDePasse123",
      newPassword: "admin123",
      confirmPassword: "admin123",
    });
    const restored = await bcrypt.compare(
      "admin123",
      db.prepare("SELECT passwordHash FROM Author WHERE id = ?").get(admin.id).passwordHash,
    );
    check("mot de passe : mot de passe d'origine restauré", restored);
  }

  // 8) Détail de l'abonnement
  const detail = await request("GET", "/mon-compte/abonnement", { jar: adminJar });
  check("abonné : GET /mon-compte/abonnement -> 200", detail.status === 200, `status=${detail.status}`);
  check("détail : formule, statut et dates",
    detail.body.includes("Détail de la formule") && detail.body.includes("Statut") &&
      detail.body.includes("Début de la période") && detail.body.includes("Fin de la période"));
  // WP7e : la chronologie reconstituée a été remplacée par le journal réel.
  check("détail : historique des événements", detail.body.includes("Historique des événements"));
  check("détail : bouton « Changer de plan » vers /abonnement",
    detail.body.includes("Changer de plan") && detail.body.includes('href="/abonnement"'));

  // 9) Annulation / réactivation sur un abonnement Stripe réel (journaliste)
  let customerId = null;
  let subscriptionId = null;
  try {
    db.prepare("DELETE FROM Payment WHERE userId = ?").run(journalist.id);
    db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId IN (SELECT id FROM Subscription WHERE userId = ?)").run(journalist.id);
    db.prepare("DELETE FROM Subscription WHERE userId = ?").run(journalist.id);
    db.prepare("UPDATE Author SET isPremium = 0, stripeCustomerId = NULL WHERE id = ?").run(journalist.id);

    const customer = await stripe.customers.create({
      email: journalist.email,
      name: "Journaliste Test",
      metadata: { userId: journalist.id, purpose: "check-wp7d" },
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
      const row = db.prepare("SELECT status FROM Subscription WHERE stripeSubscriptionId = ?").get(subscriptionId);
      if (row?.status === "ACTIVE") break;
      await sleep(1000);
    }
    check("abonné Stripe réel : abonnement actif en base",
      db.prepare("SELECT status FROM Subscription WHERE stripeSubscriptionId = ?").get(subscriptionId)?.status === "ACTIVE");

    const journalistJar = await login("journalist@example.com", "password123");
    const journalistPage = await request("GET", "/mon-compte", { jar: journalistJar });
    check("abonné : date de renouvellement affichée",
      journalistPage.body.includes("Prochain renouvellement"));
    check("abonné : bouton « Annuler l'abonnement »",
      journalistPage.body.includes("Annuler l&#x27;abonnement"));
    check("abonné : bouton « Gérer mon abonnement »",
      journalistPage.body.includes("Gérer mon abonnement"));

    const cancelId = clientActionId("cancelSubscription");
    const reactivateId = clientActionId("reactivateSubscription");
    const portalId = clientActionId("openBillingPortal");
    check("actions client : identifiants trouvés",
      Boolean(cancelId && reactivateId && portalId));

    if (cancelId) {
      const cancelResult = await callAction(journalistJar, "/mon-compte", cancelId);
      check("annulation : action acceptée", cancelResult.status === 200, `status=${cancelResult.status}`);
      await sleep(1500);
      const stripeState = await stripe.subscriptions.retrieve(subscriptionId);
      check("annulation : cancel_at_period_end côté Stripe",
        stripeState.cancel_at_period_end === true, String(stripeState.cancel_at_period_end));
      check("annulation : cancelAtPeriodEnd en base",
        db.prepare("SELECT cancelAtPeriodEnd FROM Subscription WHERE stripeSubscriptionId = ?").get(subscriptionId)?.cancelAtPeriodEnd === 1);

      const afterCancel = await request("GET", "/mon-compte", { jar: journalistJar });
      check("annulation : « Votre abonnement se termine le … »",
        /Votre abonnement se termine le/.test(afterCancel.body));
      check("annulation : bouton « Réactiver » affiché", afterCancel.body.includes("Réactiver"));

      const reactivateResult = await callAction(journalistJar, "/mon-compte", reactivateId);
      check("réactivation : action acceptée", reactivateResult.status === 200, `status=${reactivateResult.status}`);
      await sleep(1500);
      const reactivated = await stripe.subscriptions.retrieve(subscriptionId);
      check("réactivation : cancel_at_period_end annulé côté Stripe",
        reactivated.cancel_at_period_end === false, String(reactivated.cancel_at_period_end));
      check("réactivation : cancelAtPeriodEnd en base",
        db.prepare("SELECT cancelAtPeriodEnd FROM Subscription WHERE stripeSubscriptionId = ?").get(subscriptionId)?.cancelAtPeriodEnd === 0);

      const portalResult = await callAction(journalistJar, "/mon-compte", portalId);
      const portalUrl = (portalResult.body.match(/https:\/\/billing\.stripe\.com\/[^"\\\s]+/) ?? [])[0];
      check("portail de facturation : URL renvoyée", Boolean(portalUrl),
        portalUrl ? portalUrl.slice(0, 50) + "…" : portalResult.body.slice(0, 120));
    }
  } finally {
    if (subscriptionId) await stripe.subscriptions.cancel(subscriptionId).catch(() => {});
    db.prepare("DELETE FROM Payment WHERE userId = ?").run(journalist.id);
    db.prepare("DELETE FROM SubscriptionEvent WHERE subscriptionId IN (SELECT id FROM Subscription WHERE userId = ?)").run(journalist.id);
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
