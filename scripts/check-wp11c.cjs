/**
 * Vérification du WP11c — inscription publique, préférences et désabonnement sûr.
 * Exécution : PORT=3002 node scripts/check-wp11c.cjs
 *
 * La suite exerce les parcours comme le ferait un navigateur : soumission du
 * formulaire public en multipart (chemin sans JavaScript), clic sur le bouton de
 * désabonnement (Server Action liée), enregistrement des préférences, et
 * création d'un compte depuis le backoffice avec la case newsletter.
 *
 * Deux points de méthode :
 *
 *  - l'envoi d'e-mails n'est pas simulé ici : les assertions portent sur l'état
 *    en base (abonné créé, jeton, statut) et, **si** l'application est configurée
 *    sur un serveur Resend factice, sur l'e-mail réellement produit. Le libellé
 *    du contrôle le dit ;
 *  - la limitation de débit est par adresse IP : la suite envoie un
 *    `x-forwarded-for` propre à son exécution, sinon un second passage serait
 *    bloqué par les compteurs du premier.
 *
 * Toutes les données créées sont préfixées « chk11c » et supprimées à la fin.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const bcrypt = require("bcryptjs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const ORIGIN = `http://${HOST}:${PORT}`;
const ROOT = path.resolve(__dirname, "..");

/** Serveur Resend factice éventuel (voir check-wp11b) : on lit ce qu'il a reçu. */
const STUB_PORT = Number(process.env.STUB_PORT || 3100);

const dbUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(ROOT, dbUrl.replace(/^file:(\/\/)?/, "")));
db.pragma("foreign_keys = true");

const readSource = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const actionsSource = readSource("src/app/newsletter/actions.ts");
const formSource = readSource("src/components/NewsletterForm.tsx");
const signupPage = readSource("src/app/newsletter/page.tsx");
const confirmPageSource = readSource("src/app/newsletter/confirm/[token]/page.tsx");
const unsubscribeSource = readSource("src/app/newsletter/unsubscribe/[token]/page.tsx");
const preferencesSource = readSource("src/app/newsletter/preferences/[token]/page.tsx");
const sendSource = readSource("src/lib/newsletter-send.ts");
const rateLimitSource = readSource("src/lib/rate-limit.ts");
const footerSource = readSource("src/components/Footer.tsx");
const homeSource = readSource("src/app/page.tsx");
const userFormSource = readSource("src/app/backoffice/users/UserForm.tsx");
const userActionsSource = readSource("src/app/backoffice/users/actions.ts");
const schema = readSource("prisma/schema.prisma");
const packageJson = JSON.parse(readSource("package.json"));

const TAG = `chk11c-${crypto.randomBytes(4).toString("hex")}`;
/** IP propre à cette exécution : les compteurs de débit ne se croisent pas. */
const FAKE_IP = `198.51.100.${crypto.randomInt(1, 250)}`;
/** IP dédiée au contrôle de la limite, pour ne pas la consommer avant l'heure. */
const LIMIT_IP = `198.51.100.${crypto.randomInt(1, 250)}`;
const ids = {
  listA: `${TAG}-liste-a`,
  listB: `${TAG}-liste-b`,
  listInactive: `${TAG}-liste-inactive`,
  pending: `${TAG}-en-attente`,
  confirmed: `${TAG}-confirme`,
  unsubscribed: `${TAG}-desabonne`,
  prefs: `${TAG}-preferences`,
  bounced: `${TAG}-rejete`,
  user: `${TAG}-utilisateur`,
};
const address = (id) => `${id}@example.test`;

/* ------------------------------------------------------------------ outils */

function createJar() {
  const store = new Map();
  return {
    absorb(list) {
      for (const raw of list ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    has: (name) => Boolean(store.get(name)),
  };
}

function request(method, urlPath, { jar, form, headers: extra, raw, contentType } = {}) {
  const body = raw ?? (form ? new URLSearchParams(form).toString() : null);
  const headers = { ...(extra ?? {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = contentType ?? "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          jar?.absorb(res.headers["set-cookie"]);
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = (urlPath, options) => request("GET", urlPath, options);

/** IP simulée : c'est elle qui porte le compteur d'inscriptions. */
const ipHeaders = { "x-forwarded-for": FAKE_IP };

async function login(emailAddress, password, callbackPath = "/backoffice/users") {
  const jar = createJar();
  await get("/login", { jar });
  const csrfBody = (await get("/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(`Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF).`);
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email: emailAddress, password, callbackUrl: `${ORIGIN}${callbackPath}` },
  });
  return jar;
}

/** Appel direct d'une Server Action (protocole Next-Action). */
function callAction(jar, pagePath, actionId, args = []) {
  return request("POST", pagePath, {
    jar,
    raw: JSON.stringify(args),
    contentType: "text/plain;charset=UTF-8",
    headers: { "next-action": actionId, origin: ORIGIN, ...ipHeaders },
  });
}

/** Champs cachés du premier formulaire contenant tous les extraits demandés. */
function formFields(html, required) {
  const needles = Array.isArray(required) ? required : [required];
  const chunk = html
    .split(/<form/i)
    .slice(1)
    .find((form) => needles.every((needle) => form.includes(needle)));
  if (!chunk) return null;

  const fields = {};
  for (const tag of chunk.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const name = tag.match(/name="([^"]+)"/)?.[1];
    if (!name) continue;
    fields[name] = (tag.match(/value="([^"]*)"/)?.[1] ?? "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
  }
  return fields;
}

/** Soumet le formulaire d'inscription comme un navigateur sans JavaScript. */
async function submitSignup({
  email: addressValue,
  name,
  listes = [],
  consentement = true,
  ip = FAKE_IP,
}) {
  const page = await get("/newsletter");
  const fields = formFields(page.body, 'name="consentement"');
  if (!fields) return { ok: false, reason: "formulaire d'inscription introuvable" };

  const entries = { ...fields, email: addressValue };
  if (name) entries.name = name;
  if (consentement) entries.consentement = "on";
  for (const listId of listes) {
    if (!entries.listes) entries.listes = listId;
    else entries.listes = [].concat(entries.listes, listId);
  }

  const boundary = `----WP11C${crypto.randomBytes(8).toString("hex")}`;
  const parts = [];
  for (const [key, value] of Object.entries(entries)) {
    for (const single of [].concat(value)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${single}\r\n`,
        ),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const response = await request("POST", "/newsletter", {
    raw: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
    headers: { origin: ORIGIN, referer: `${ORIGIN}/newsletter`, "x-forwarded-for": ip },
  });
  return { ok: response.status < 400, status: response.status, body: response.body };
}

/** Soumet un formulaire d'action liée (préférences, désabonnement, utilisateur). */
async function submitBoundForm(jar, urlPath, boundArg, fields = {}, { keep = [] } = {}) {
  const page = await get(urlPath, { jar });
  const bound = boundArg ? boundFieldsContaining(page.body, boundArg) : formFields(page.body, keep);
  if (!bound) return { ok: false, reason: `formulaire introuvable (${boundArg ?? keep.join(" + ")})` };

  const boundary = `----WP11C${crypto.randomBytes(8).toString("hex")}`;
  const entries = { ...bound, ...fields };
  const parts = [];
  for (const [key, value] of Object.entries(entries)) {
    for (const single of [].concat(value)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${single}\r\n`,
        ),
      );
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const response = await request("POST", urlPath, {
    jar,
    raw: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
    headers: { origin: ORIGIN, referer: `${ORIGIN}${urlPath}`, ...ipHeaders },
  });
  return { ok: response.status < 400, status: response.status, location: response.location };
}

/** Champs cachés d'un formulaire d'action liée (`.bind`), repéré par son argument. */
function boundFieldsContaining(html, id) {
  for (const chunk of html.split(/<form/i).slice(1)) {
    const tags = chunk.match(/<input[^>]*type="hidden"[^>]*>/g) ?? [];
    const fields = {};
    let bound = false;
    for (const tag of tags) {
      const name = tag.match(/name="([^"]+)"/)?.[1];
      if (!name) continue;
      const value = (tag.match(/value="([^"]*)"/)?.[1] ?? "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&");
      fields[name] = value;
      if (/^\$ACTION_\d+:\d+$/.test(name) && value.includes(id)) bound = true;
    }
    if (bound) return fields;
  }
  return null;
}

const text = (html) => html.replace(/<!-- -->/g, "");

/* ------------------------------------------------- serveur Resend factice */

/**
 * Serveur Resend minimal, comme celui de `check-wp11b` : si l'application est
 * lancée avec `RESEND_BASE_URL` sur ce port (voir le README), elle y écrit
 * réellement ses e-mails, et la suite peut vérifier leur contenu. Sinon le
 * contrôle de l'e-mail se rabat sur l'état en base, et le dit dans son libellé.
 */
const stubMails = [];
let stubServer = null;

function startStub() {
  return new Promise((resolve) => {
    stubServer = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if (req.method !== "POST" || !req.url.startsWith("/emails")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "not found" }));
          return;
        }
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = {};
        }
        stubMails.push({
          to: parsed.to,
          subject: parsed.subject,
          html: parsed.html ?? "",
          text: parsed.text ?? "",
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `stub-${stubMails.length}` }));
      });
    });
    // Port déjà pris (autre suite lancée en parallèle) : on continue sans stub.
    stubServer.on("error", () => resolve());
    stubServer.listen(STUB_PORT, "127.0.0.1", resolve);
  });
}

function stopStub() {
  return new Promise((resolve) => {
    if (!stubServer || !stubServer.listening) return resolve();
    stubServer.close(() => resolve());
  });
}

/* ---------------------------------------------------------------- fixtures */

const subscriberRow = (id) =>
  db
    .prepare(
      "SELECT email, name, status, source, confirmationToken, confirmedAt, unsubscribedAt, userId FROM NewsletterSubscriber WHERE id = ?",
    )
    .get(id);
const subscriberByEmail = (addressValue) =>
  db.prepare("SELECT id, status, confirmationToken FROM NewsletterSubscriber WHERE email = ?").get(addressValue);
const listsOf = (id) =>
  db
    .prepare(
      "SELECT l.id FROM NewsletterList l JOIN _NewsletterListToNewsletterSubscriber j ON j.A = l.id WHERE j.B = ? ORDER BY l.id",
    )
    .all(id)
    .map((row) => row.id);

function insertList(id, name, active = 1) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO NewsletterList (id, name, slug, description, active, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, id, `Description ${id}`, active, now, now);
}

function insertSubscriber(id, status, listIds = []) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO NewsletterSubscriber (id, email, name, status, confirmationToken, confirmedAt, unsubscribedAt, userId, source, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'import', ?, ?)`,
  ).run(
    id,
    address(id),
    `Abonné ${id}`,
    status,
    `${TAG}-jeton-${id}`,
    status === "CONFIRMED" ? now : null,
    status === "UNSUBSCRIBED" ? now : null,
    now,
    now,
  );
  for (const listId of listIds) {
    db.prepare("INSERT INTO _NewsletterListToNewsletterSubscriber (A, B) VALUES (?, ?)").run(listId, id);
  }
}

function cleanup() {
  const prefix = "chk11c%";
  db.prepare("DELETE FROM NewsletterSend WHERE subscriberId LIKE ?").run(prefix);
  db.prepare("DELETE FROM _NewsletterListToNewsletterSubscriber WHERE A LIKE ? OR B LIKE ?").run(prefix, prefix);
  db.prepare("DELETE FROM NewsletterSubscriber WHERE id LIKE ? OR email LIKE ?").run(prefix, prefix);
  db.prepare("DELETE FROM NewsletterList WHERE id LIKE ?").run(prefix);
  db.prepare("DELETE FROM Author WHERE id LIKE ? OR email LIKE ?").run(prefix, prefix);
}

/* ------------------------------------------------------------------- tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/** Identifiant d'une action serveur, cherché dans les manifestes de Next. */
function findActionId(exportedName) {
  const root = path.join(ROOT, ".next/server/app");
  if (!existsSync(root)) return null;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name !== "server-reference-manifest.json") continue;
      try {
        const manifest = JSON.parse(readFileSync(full, "utf8"));
        for (const [id, value] of Object.entries(manifest.node ?? {})) {
          if (value?.exportedName === exportedName) return id;
        }
      } catch {
        /* manifeste illisible */
      }
    }
  }
  return null;
}

async function main() {
  cleanup();
  await startStub();

  /* -------------------------------------------------------- 1) Code et cadre */
  console.log("--- Server Actions, formulaire et pages ---");
  check(
    "actions publiques : inscription, désabonnement, préférences",
    ["subscribeToNewsletter", "confirmUnsubscribe", "updatePreferences"].every((name) =>
      actionsSource.includes(`export async function ${name}`),
    ),
  );
  check(
    "l'inscription ne renvoie jamais le jeton dans sa réponse",
    /export type SubscribeState = \{[\s\S]*?\};/.test(actionsSource) &&
      !/token/.test(actionsSource.match(/export type SubscribeState = \{[\s\S]*?\};/)?.[0] ?? "token"),
  );
  check(
    "limitation de débit : 3 inscriptions par heure et par IP",
    /NEWSLETTER_RATE_LIMIT: RateLimitOptions = \{\s*max: 3/.test(rateLimitSource) &&
      actionsSource.includes("consumeRateLimit(rateLimitKey(ip), NEWSLETTER_RATE_LIMIT)") &&
      actionsSource.includes("clientIpFromHeaders(await headers())"),
  );
  check(
    "consentement et adresse validés avant toute écriture",
    actionsSource.includes('consent !== "on"') && actionsSource.includes("EMAIL_PATTERN.test(rawEmail)"),
  );
  check(
    "double opt-in : un nouvel abonné est créé en PENDING avec un jeton",
    /status: "PENDING"/.test(actionsSource) && actionsSource.includes("confirmationToken: token"),
  );
  check(
    "une adresse déjà confirmée n'est pas rétrogradée en attente",
    actionsSource.includes('if (existing.status === "CONFIRMED")'),
  );
  check(
    "une adresse rejetée (BOUNCED) n'est pas réinscrite",
    actionsSource.includes('existing?.status === "BOUNCED"'),
  );

  check("formulaire : composant client avec état de soumission", formSource.startsWith('"use client"'));
  check(
    "formulaire : email requis, nom facultatif, listes en cases à cocher",
    /name="email"[\s\S]{0,200}required/.test(formSource) &&
      /name="name"/.test(formSource) &&
      !/name="name"[\s\S]{0,200}required/.test(formSource) &&
      formSource.includes('name="listes"'),
  );
  check(
    "formulaire : case RGPD absente de tout état coché par défaut",
    formSource.includes('name="consentement"') &&
      !/name="consentement"[\s\S]{0,200}defaultChecked/.test(formSource) &&
      formSource.includes('href="/confidentialite"'),
  );
  check("formulaire : bouton « S'inscrire »", formSource.includes("S&apos;inscrire") || formSource.includes("S'inscrire"));

  check(
    "page de désabonnement : lecture seule, la mutation passe par le bouton",
    unsubscribeSource.includes("getSubscriberByToken") &&
      unsubscribeSource.includes("confirmUnsubscribe.bind(null, token)") &&
      !/await confirmUnsubscribe\(/.test(unsubscribeSource),
  );
  check(
    "page de préférences : listes pré-cochées et enregistrement par Server Action",
    preferencesSource.includes("updatePreferences.bind(null, token)") &&
      preferencesSource.includes("defaultChecked={subscriber.listIds.includes(list.id)}"),
  );
  check(
    "page de confirmation : lien de gestion des préférences",
    confirmPageSource.includes("/newsletter/preferences/"),
  );
  check(
    "lib/newsletter-send : lecture, désabonnement et préférences séparés",
    ["getSubscriberByToken", "confirmUnsubscribeByToken", "updateSubscriberPreferences", "availableLists"].every(
      (name) => sendSource.includes(`export async function ${name}`) || sendSource.includes(`function ${name}`),
    ),
  );
  check(
    "préférences : une sélection vide est refusée, un désabonné qui choisit une liste se réabonne",
    sendSource.includes('return { status: "empty" }') &&
      sendSource.includes("resubscribing") &&
      sendSource.includes("unsubscribedAt: null"),
  );

  check(
    "footer public : lien « Newsletter »",
    footerSource.includes('href="/newsletter"') && footerSource.includes("Newsletter"),
  );
  check(
    "accueil : encart newsletter vers /newsletter",
    homeSource.includes("encart-newsletter") &&
      homeSource.includes("Recevez l&apos;essentiel de l&apos;actualité sportive") &&
      /href="\/newsletter"/.test(homeSource),
  );
  check(
    "création de compte : case « Recevoir la newsletter » décochée",
    userFormSource.includes('name="newsletter"') &&
      !/name="newsletter"[\s\S]{0,200}defaultChecked/.test(userFormSource) &&
      userFormSource.includes("Recevoir la newsletter"),
  );
  check(
    "création de compte : abonnement CONFIRMED lié au compte (userId)",
    userActionsSource.includes("newsletterSubscriber.upsert") &&
      userActionsSource.includes('source: "compte"') &&
      userActionsSource.includes("userId: created.id"),
  );
  check(
    "périmètre : aucun CAPTCHA, aucun modèle Prisma ajouté",
    !["@hcaptcha/react-hcaptcha", "react-google-recaptcha", "@marsidev/react-turnstile", "hcaptcha"].some(
      (name) => name in { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) },
    ) && !/model (Captcha|NewsletterPreference)/.test(schema),
  );
  check(
    "périmètre : modules interdits inchangés",
    ["src/lib/prisma.ts", "src/lib/auth.ts", "src/lib/stripe.ts", "src/lib/seo.ts", "src/lib/analytics.ts", "src/lib/engagement.ts", "src/lib/notifications.ts", "src/middleware.ts"].every(
      (file) => !/newsletter/i.test(readSource(file)),
    ),
  );

  /* ------------------------------------------------------------- 2) Fixtures */
  console.log("\n--- Jeu de test ---");
  insertList(ids.listA, `Hebdo ${TAG}`);
  insertList(ids.listB, `Mercato ${TAG}`);
  insertList(ids.listInactive, `Archive ${TAG}`, 0);
  insertSubscriber(ids.pending, "PENDING", [ids.listA]);
  insertSubscriber(ids.confirmed, "CONFIRMED", [ids.listA]);
  insertSubscriber(ids.unsubscribed, "UNSUBSCRIBED", []);
  insertSubscriber(ids.prefs, "UNSUBSCRIBED", []);
  insertSubscriber(ids.bounced, "BOUNCED", [ids.listA]);
  check(
    "trois listes et cinq abonnés créés",
    db.prepare("SELECT COUNT(*) AS c FROM NewsletterList WHERE id LIKE ?").get(`${TAG}%`).c === 3 &&
      db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?").get(`${TAG}%`).c === 5,
  );

  /* ------------------------------------------------ 3) Page d'inscription */
  console.log("\n--- Page /newsletter ---");
  const page = await get("/newsletter");
  check("page publique accessible", page.status === 200, `status=${page.status}`);
  check(
    "formulaire complet (email, nom, listes, consentement)",
    ['name="email"', 'name="name"', 'name="listes"', 'name="consentement"'].every((needle) =>
      page.body.includes(needle),
    ),
  );
  check(
    "listes actives proposées, liste inactive exclue",
    page.body.includes(`Hebdo ${TAG}`) &&
      page.body.includes(`Mercato ${TAG}`) &&
      !page.body.includes(`Archive ${TAG}`),
  );
  check(
    "case RGPD non cochée dans le HTML servi",
    /id="consentement"[^>]*>/.test(page.body) &&
      !/<input[^>]*id="consentement"[^>]*checked/.test(page.body),
  );
  check(
    "mention de la politique de confidentialité et du double opt-in",
    page.body.includes('href="/confidentialite"') &&
      text(page.body).includes("double opt-in"),
  );
  check("footer : lien Newsletter présent", page.body.includes('href="/newsletter"'));
  const home = await get("/");
  check(
    "accueil : encart « Recevez l'essentiel » vers /newsletter",
    home.status === 200 &&
      text(home.body).includes("Recevez l'essentiel de l'actualité sportive") &&
      home.body.includes('href="/newsletter"'),
  );

  /* ------------------------------------------------ 4) Inscription publique */
  console.log("\n--- Inscription (chemin sans JavaScript) ---");
  const newAddress = address(`${TAG}-nouveau`);
  const signup = await submitSignup({
    email: newAddress,
    name: "Nouvelle Abonnée",
    listes: [ids.listA, ids.listB],
  });
  const created = subscriberByEmail(newAddress);
  const createdRow = created ? subscriberRow(created.id) : null;
  check(
    "inscription : abonné PENDING avec jeton et source « site »",
    signup.ok &&
      createdRow?.status === "PENDING" &&
      Boolean(createdRow?.confirmationToken) &&
      createdRow?.source === "site",
    `${createdRow?.status ?? "aucun abonné"} / source ${createdRow?.source ?? "—"}`,
  );
  check(
    "inscription : listes choisies enregistrées",
    created && listsOf(created.id).join(",") === [ids.listA, ids.listB].sort().join(","),
    created ? listsOf(created.id).join(", ") : "—",
  );
  check(
    "inscription : page de confirmation annoncée",
    text(signup.body).includes("Vérifiez votre boîte mail pour confirmer votre inscription"),
  );

  // L'application écrit au serveur Resend factice si elle y est configurée.
  const stubConfigured = stubMails.length > 0;
  check(
    stubConfigured
      ? "inscription : e-mail de confirmation réellement produit (serveur factice)"
      : "inscription : envoi d'e-mail désactivé, l'inscription reste enregistrée",
    stubConfigured
      ? stubMails.some(
          (mail) =>
            mail.to === newAddress &&
            /Confirmez votre inscription/.test(mail.subject) &&
            mail.html.includes(`/newsletter/confirm/${createdRow.confirmationToken}`),
        )
      : Boolean(createdRow?.confirmationToken),
    stubConfigured ? `${stubMails.length} message(s) capturé(s)` : "aucun serveur factice détecté",
  );

  const withoutConsent = await submitSignup({ email: address(`${TAG}-sans-accord`), consentement: false });
  const invalidEmail = await submitSignup({ email: "pas-une-adresse", listes: [ids.listA] });
  check(
    "consentement manquant : aucune inscription, message explicite",
    !subscriberByEmail(address(`${TAG}-sans-accord`)) &&
      text(withoutConsent.body).includes("Merci de cocher la case"),
  );
  check(
    "adresse invalide : aucune inscription",
    !subscriberByEmail("pas-une-adresse") && text(invalidEmail.body).includes("ne semble pas valide"),
  );

  const beforeAgain = subscriberRow(ids.confirmed);
  const again = await submitSignup({ email: address(ids.confirmed), listes: [ids.listA] });
  const afterAgain = subscriberRow(ids.confirmed);
  check(
    "adresse déjà confirmée : pas de doublon, statut conservé",
    subscriberByEmail(address(ids.confirmed)).id === ids.confirmed &&
      afterAgain.status === "CONFIRMED" &&
      afterAgain.confirmedAt === beforeAgain.confirmedAt,
  );
  check(
    "adresse déjà connue : message « déjà inscrit » avec renvoi d'e-mail",
    text(again.body).includes("Vous êtes déjà inscrit"),
  );

  const resubscribe = await submitSignup({ email: address(ids.unsubscribed), listes: [ids.listB] });
  const afterResubscribe = subscriberRow(ids.unsubscribed);
  check(
    "adresse désabonnée : nouvel accord exigé (PENDING) et listes mises à jour",
    resubscribe.ok &&
      afterResubscribe.status === "PENDING" &&
      afterResubscribe.unsubscribedAt === null &&
      listsOf(ids.unsubscribed).join(",") === ids.listB,
    `${afterResubscribe.status} / ${listsOf(ids.unsubscribed).join(", ")}`,
  );

  const bouncedSignup = await submitSignup({
    email: address(ids.bounced),
    listes: [ids.listA],
    // IP dédiée : le compteur de l'IP principale est déjà consommé par les cas
    // précédents, et c'est bien le refus « adresse rejetée » qu'on veut observer.
    ip: `198.51.100.${crypto.randomInt(1, 250)}`,
  });
  check(
    "adresse rejetée : réinscription refusée",
    subscriberRow(ids.bounced).status === "BOUNCED" &&
      text(bouncedSignup.body).includes("rejetée par notre service d'envoi"),
  );

  /* ------------------------------------------------- 5) Limitation de débit */
  console.log("\n--- Limitation de débit (3 par heure et par IP) ---");
  // IP dédiée : le compteur de cette IP part de zéro, quoi qu'il se soit passé
  // plus haut dans le parcours.
  const limitAddresses = [1, 2, 3].map((n) => address(`${TAG}-limite-${n}`));
  for (const target of limitAddresses) {
    await submitSignup({ email: target, listes: [ids.listA], ip: LIMIT_IP });
  }
  const blocked = await submitSignup({
    email: address(`${TAG}-limite-bloquee`),
    listes: [ids.listA],
    ip: LIMIT_IP,
  });
  check(
    "les trois inscriptions de la fenêtre sont acceptées",
    limitAddresses.every((target) => Boolean(subscriberByEmail(target))),
    limitAddresses.filter((target) => Boolean(subscriberByEmail(target))).length + "/3",
  );
  check(
    "quatrième inscription dans l'heure : refus explicite, aucune création",
    text(blocked.body).includes("limite de 3 inscriptions par heure") &&
      !subscriberByEmail(address(`${TAG}-limite-bloquee`)),
    text(blocked.body).match(/limite de 3 inscriptions[^<]*/)?.[0]?.slice(0, 70) ?? "aucun message",
  );
  check(
    "le compteur est bien par IP (une autre IP n'est pas bloquée)",
    await (async () => {
      const otherIp = `203.0.113.${crypto.randomInt(1, 250)}`;
      const page2 = await get("/newsletter");
      const fields = formFields(page2.body, 'name="consentement"');
      const boundary = `----WP11C${crypto.randomBytes(8).toString("hex")}`;
      const parts = Object.entries({ ...fields, email: address(`${TAG}-autre-ip`), consentement: "on" }).map(
        ([key, value]) =>
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
          ),
      );
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      await request("POST", "/newsletter", {
        raw: Buffer.concat(parts),
        contentType: `multipart/form-data; boundary=${boundary}`,
        headers: { origin: ORIGIN, "x-forwarded-for": otherIp },
      });
      return Boolean(subscriberByEmail(address(`${TAG}-autre-ip`)));
    })(),
  );

  /* ------------------------------------------------ 6) Confirmation par jeton */
  console.log("\n--- Confirmation et désabonnement ---");
  const confirmToken = subscriberRow(ids.pending).confirmationToken;
  const confirm = await get(`/newsletter/confirm/${confirmToken}`);
  const confirmedRow = subscriberRow(ids.pending);
  check(
    "confirmation : CONFIRMED avec date, page de succès",
    confirm.status === 200 &&
      confirmedRow.status === "CONFIRMED" &&
      Boolean(confirmedRow.confirmedAt) &&
      text(confirm.body).includes("Inscription confirmée"),
  );
  check(
    "confirmation : lien vers la gestion des préférences",
    confirm.body.includes(`/newsletter/preferences/${confirmToken}`),
  );
  check(
    "confirmation rejouée : aucun changement, message dédié",
    (await get(`/newsletter/confirm/${confirmToken}`)).body.includes("déjà confirmée"),
  );
  check("jeton de confirmation inconnu : 404", (await get(`/newsletter/confirm/${TAG}-inconnu`)).status === 404);

  /* ------------------------------------------- 7) Désabonnement sécurisé */
  const unsubToken = subscriberRow(ids.confirmed).confirmationToken;
  const beforeView = subscriberRow(ids.confirmed);
  const view = await get(`/newsletter/unsubscribe/${unsubToken}`);
  const afterView = subscriberRow(ids.confirmed);
  check(
    "désabonnement : le GET n'écrit rien",
    view.status === 200 &&
      afterView.status === beforeView.status &&
      afterView.unsubscribedAt === beforeView.unsubscribedAt,
    `statut après GET : ${afterView.status}`,
  );
  check(
    "désabonnement : page de confirmation avec bouton explicite",
    text(view.body).includes("Voulez-vous vraiment vous désabonner") &&
      text(view.body).includes("Confirmer le désabonnement") &&
      view.body.includes(`/newsletter/preferences/${unsubToken}`),
  );

  const unsubscribePost = await submitBoundForm(null, `/newsletter/unsubscribe/${unsubToken}`, unsubToken);
  const afterPost = subscriberRow(ids.confirmed);
  check(
    "désabonnement : le bouton (POST) passe l'abonné en UNSUBSCRIBED",
    afterPost.status === "UNSUBSCRIBED" && Boolean(afterPost.unsubscribedAt),
    `${afterPost.status}`,
  );
  check(
    "désabonnement : redirection vers la page de succès",
    String(unsubscribePost.location ?? "").includes("confirme=1"),
    String(unsubscribePost.location ?? "—").slice(0, 60),
  );
  const successPage = await get(`/newsletter/unsubscribe/${unsubToken}?confirme=1`);
  check(
    "désabonnement : message de succès après confirmation",
    text(successPage.body).includes("Vous êtes désabonné."),
  );
  const dateAfterPost = subscriberRow(ids.confirmed).unsubscribedAt;
  await submitBoundForm(null, `/newsletter/unsubscribe/${unsubToken}`, unsubToken);
  check(
    "désabonnement rejoué : aucun bouton, date conservée",
    (await get(`/newsletter/unsubscribe/${unsubToken}`)).body.includes("déjà désabonné") &&
      subscriberRow(ids.confirmed).unsubscribedAt === dateAfterPost,
  );
  const unsubInvalid = await get(`/newsletter/unsubscribe/${TAG}-inconnu`);
  check("jeton de désabonnement inconnu : 404", unsubInvalid.status === 404, `status=${unsubInvalid.status}`);

  /* ---------------------------------------------------- 8) Préférences */
  console.log("\n--- Préférences ---");
  // Abonné dédié : `ids.unsubscribed` a été remis en attente par le test
  // d'inscription ci-dessus, on ne peut donc pas s'en servir pour observer
  // l'état « désabonné ».
  const prefToken = subscriberRow(ids.prefs).confirmationToken;
  const preferences = await get(`/newsletter/preferences/${prefToken}`);
  check("page de préférences accessible", preferences.status === 200, `status=${preferences.status}`);
  check(
    "listes actives proposées avec leur description",
    preferences.body.includes(`Hebdo ${TAG}`) &&
      preferences.body.includes(`Mercato ${TAG}`) &&
      !preferences.body.includes(`Archive ${TAG}`),
  );
  check(
    "état de désabonnement expliqué, avec possibilité de se réabonner",
    text(preferences.body).includes("Vous êtes actuellement désabonné") &&
      text(preferences.body).includes("vous réabonne"),
  );

  await submitBoundForm(null, `/newsletter/preferences/${prefToken}`, prefToken, { listes: [ids.listB] });
  const afterPrefs = subscriberRow(ids.prefs);
  check(
    "enregistrement : le désabonné redevient CONFIRMED avec la liste choisie",
    afterPrefs.status === "CONFIRMED" &&
      afterPrefs.unsubscribedAt === null &&
      listsOf(ids.prefs).join(",") === ids.listB,
    `${afterPrefs.status} / ${listsOf(ids.prefs).join(", ")}`,
  );
  const savedPage = await get(`/newsletter/preferences/${prefToken}?enregistre=ok`);
  check("enregistrement : compte rendu affiché", text(savedPage.body).includes("Vos préférences sont enregistrées."));
  check(
    "enregistrement : la liste choisie est pré-cochée au retour",
    new RegExp(`id="pref-${ids.listB}"[^>]*checked`).test(savedPage.body),
  );

  await submitBoundForm(null, `/newsletter/preferences/${prefToken}`, prefToken, {});
  check(
    "sélection vide : refusée, listes inchangées",
    (await get(`/newsletter/preferences/${prefToken}?enregistre=vide`)).body.includes(
      "Choisissez au moins une liste",
    ) && listsOf(ids.prefs).join(",") === ids.listB,
  );

  // Une adresse rejetée n'a même pas de formulaire : la page explique pourquoi.
  const bouncedPrefsToken = subscriberRow(ids.bounced).confirmationToken;
  const bouncedPrefs = await get(`/newsletter/preferences/${bouncedPrefsToken}`);
  check(
    "adresse rejetée : préférences en lecture seule, message dédié",
    bouncedPrefs.status === 200 &&
      text(bouncedPrefs.body).includes("rejetée par notre service d'envoi") &&
      !bouncedPrefs.body.includes('name="listes"') &&
      subscribedUnchanged(ids.bounced),
  );
  check(
    "jeton de préférences inconnu : 404",
    (await get(`/newsletter/preferences/${TAG}-inconnu`)).status === 404,
  );

  /* -------------------------------------- 9) Case newsletter du backoffice */
  console.log("\n--- Création de compte avec la newsletter ---");
  const adminJar = await login("admin@example.com", "admin123");
  const usersPage = await get("/backoffice/users/new", { jar: adminJar });
  check(
    "formulaire de création : case « Recevoir la newsletter » non cochée",
    usersPage.status === 200 &&
      usersPage.body.includes('name="newsletter"') &&
      !/<input[^>]*id="newsletter"[^>]*checked/.test(usersPage.body),
  );

  const withNewsletter = await submitBoundForm(adminJar, "/backoffice/users/new", null, {
    name: `Compte ${TAG}`,
    email: address(ids.user),
    password: "password123",
    role: "JOURNALIST",
    newsletter: "on",
  }, { keep: ['name="password"'] });
  const account = db.prepare("SELECT id FROM Author WHERE email = ?").get(address(ids.user));
  const accountSubscriber = subscriberByEmail(address(ids.user));
  check(
    "compte créé : abonné CONFIRMED lié à l'utilisateur",
    withNewsletter.ok &&
      Boolean(account) &&
      accountSubscriber?.status === "CONFIRMED" &&
      subscriberRow(accountSubscriber.id)?.userId === account?.id &&
      subscriberRow(accountSubscriber.id)?.source === "compte",
    `${accountSubscriber?.status ?? "aucun abonné"} / userId ${subscriberRow(accountSubscriber?.id)?.userId ? "lié" : "absent"}`,
  );

  const withoutNewsletter = await submitBoundForm(adminJar, "/backoffice/users/new", null, {
    name: `Compte sans newsletter ${TAG}`,
    email: address(`${TAG}-utilisateur-2`),
    password: "password123",
    role: "JOURNALIST",
  }, { keep: ['name="password"'] });
  check(
    "compte créé sans la case : aucun abonné",
    withoutNewsletter.ok && !subscriberByEmail(address(`${TAG}-utilisateur-2`)),
  );

  /* ------------------------------------------------- 10) Non-régression */
  console.log("\n--- Non-régression ---");
  check("accueil toujours servi", (await get("/")).status === 200);
  check("scores toujours servis", (await get("/scores")).status === 200);
  check(
    "administration newsletter accessible",
    (await get("/backoffice/newsletter", { jar: adminJar })).status === 200,
  );
  check(
    "notifications in-app toujours accessibles",
    (await get("/mon-compte/notifications", { jar: adminJar })).status === 200,
  );

  cleanup();
  const leftovers = db
    .prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?")
    .get("chk11c%").c;
  check("nettoyage : aucune donnée de test laissée en base", leftovers === 0, `${leftovers} restant(s)`);

  db.close();
  await stopStub();

  const failed = results.filter((result) => !result).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

/** Vrai si l'abonné rejeté n'a pas changé de statut ni de listes. */
function subscribedUnchanged(id) {
  const row = subscriberRow(id);
  return row.status === "BOUNCED" && listsOf(id).join(",") === ids.listA;
}

main().catch(async (error) => {
  try {
    cleanup();
  } catch {
    /* nettoyage au mieux */
  }
  await stopStub().catch(() => {});
  console.error("ERREUR:", error.stack);
  process.exit(1);
});
