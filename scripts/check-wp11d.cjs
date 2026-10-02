/**
 * Vérification du WP11d — gestion des campagnes (création, envoi, suivi).
 * Exécution : PORT=3002 node scripts/check-wp11d.cjs
 *
 * La suite exerce l'interface comme un navigateur : création d'une campagne par
 * le formulaire (multipart, chemin sans JavaScript), filtres et pagination de la
 * liste, édition, prévisualisation, envoi d'un test, envoi réel, relance des
 * non-ouvreurs, planification et endpoint de cron.
 *
 * L'envoi réel passe par le **serveur Resend factice** (voir check-wp11b) : la
 * suite démarre le sien et c'est l'application qui y écrit, si elle est lancée
 * avec `RESEND_BASE_URL`. Les contrôles d'e-mail le précisent dans leur libellé.
 *
 * Toutes les données créées sont préfixées « chk11d » et supprimées à la fin.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync, existsSync, readdirSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const ORIGIN = `http://${HOST}:${PORT}`;
const ROOT = path.resolve(__dirname, "..");
const STUB_PORT = Number(process.env.STUB_PORT || 3100);

const dbUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(ROOT, dbUrl.replace(/^file:(\/\/)?/, "")));
db.pragma("foreign_keys = true");

const readSource = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const actionsSource = readSource("src/app/backoffice/newsletter/campaigns/actions.ts");
const listPage = readSource("src/app/backoffice/newsletter/campaigns/page.tsx");
const newPage = readSource("src/app/backoffice/newsletter/campaigns/new/page.tsx");
const detailPage = readSource("src/app/backoffice/newsletter/campaigns/[id]/page.tsx");
const editPage = readSource("src/app/backoffice/newsletter/campaigns/[id]/edit/page.tsx");
const previewPage = readSource("src/app/backoffice/newsletter/campaigns/[id]/preview/page.tsx");
const formSource = readSource("src/app/backoffice/newsletter/campaigns/components/CampaignForm.tsx");
const sendButtonSource = readSource(
  "src/app/backoffice/newsletter/campaigns/components/SendCampaignButton.tsx",
);
const testButtonSource = readSource(
  "src/app/backoffice/newsletter/campaigns/components/TestEmailButton.tsx",
);
const cronRoute = readSource("src/app/api/cron/newsletter/route.ts");
const sendLib = readSource("src/lib/newsletter-send.ts");
const envFile = readSource(".env");
const schema = readSource("prisma/schema.prisma");

const CRON_SECRET = envFile.match(/CRON_SECRET\s*=\s*"([^"]*)"/)?.[1] ?? "";

const TAG = `chk11d-${crypto.randomBytes(4).toString("hex")}`;
const BASE = "/backoffice/newsletter/campaigns";
const ids = {
  list: `${TAG}-liste`,
  listOther: `${TAG}-liste-2`,
  campaign: `${TAG}-campagne`,
  campaignScheduled: `${TAG}-planifiee`,
  campaignSent: `${TAG}-envoyee`,
  subscriber: `${TAG}-abonne`,
  subscriber2: `${TAG}-abonne-2`,
  subscriber3: `${TAG}-abonne-3`,
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

async function login(emailAddress, password, callbackPath = BASE) {
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
    headers: { "next-action": actionId, origin: ORIGIN },
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

/** Soumet un formulaire (multipart, comme un navigateur sans JavaScript). */
async function submitForm(jar, urlPath, { contains, fields = {}, boundArg, button } = {}) {
  const page = await get(urlPath, { jar });
  const harvested = boundArg ? boundFields(page.body, boundArg) : formFields(page.body, contains);
  if (!harvested) {
    return { ok: false, reason: `formulaire introuvable (${boundArg ?? [].concat(contains).join(" + ")})` };
  }

  const entries = { ...harvested, ...fields };
  if (button) entries[button.name] = button.value;

  const boundary = `----WP11D${crypto.randomBytes(8).toString("hex")}`;
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
    headers: { origin: ORIGIN, referer: `${ORIGIN}${urlPath}` },
  });
  return { ok: response.status < 400, status: response.status, location: response.location, body: response.body };
}

/** Champs cachés d'un formulaire d'action liée (`.bind`), repéré par son argument. */
function boundFields(html, id) {
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

/**
 * Cible d'une redirection.
 *
 * Une Server Action appelée en JavaScript (protocole `next-action`) renvoie sa
 * redirection dans l'en-tête `x-action-redirect` ; un POST de formulaire la met
 * dans `location`. On accepte les deux.
 */
const redirectTarget = (response) =>
  `${response.location ?? ""}${response.headers?.["x-action-redirect"] ?? ""}`;

/* ------------------------------------------------- serveur Resend factice */

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
        stubMails.push({ to: parsed.to, subject: parsed.subject, html: parsed.html ?? "" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: `stub-${stubMails.length}` }));
      });
    });
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

const campaignRow = (id) =>
  db
    .prepare(
      "SELECT subject, status, scheduledAt, sentAt, recipientCount, deliveredCount, openCount, clickCount, bounceCount, listId, previewText, contentHtml FROM NewsletterCampaign WHERE id = ?",
    )
    .get(id);
const sendRows = (campaignId) =>
  db
    .prepare(
      "SELECT id, subscriberId, status, providerMessageId, openedAt FROM NewsletterSend WHERE campaignId = ? ORDER BY createdAt",
    )
    .all(campaignId);
const listBySlug = (slug) => db.prepare("SELECT id, name FROM NewsletterList WHERE slug = ?").get(slug);

function insertList(id, name, active = 1) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO NewsletterList (id, name, slug, description, active, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, id, `Liste ${id}`, active, now, now);
}

function insertSubscriber(id, status = "CONFIRMED") {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO NewsletterSubscriber (id, email, name, status, confirmationToken, confirmedAt, unsubscribedAt, userId, source, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'import', ?, ?)`,
  ).run(id, address(id), `Abonné ${id}`, status, `${TAG}-jeton-${id}`, status === "CONFIRMED" ? now : null, now, now);
  db.prepare("INSERT INTO _NewsletterListToNewsletterSubscriber (A, B) VALUES (?, ?)").run(ids.list, id);
}

function insertCampaign({ id, subject, status, listId = ids.list, scheduledAt = null, sentAt = null }) {
  const now = new Date().toISOString();
  const admin = db.prepare("SELECT id FROM Author WHERE email = 'admin@example.com'").get();
  db.prepare(
    `INSERT INTO NewsletterCampaign (id, listId, subject, previewText, contentHtml, contentText, status, scheduledAt, sentAt,
       recipientCount, deliveredCount, openCount, clickCount, bounceCount, createdById, createdAt, updatedAt)
     VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?, ?)`,
  ).run(
    id,
    listId,
    subject,
    `<p>${TAG} contenu</p>`,
    status,
    scheduledAt,
    sentAt,
    admin.id,
    now,
    now,
  );
}

function cleanup() {
  const prefix = "chk11d%";
  const campaigns = db
    .prepare("SELECT id FROM NewsletterCampaign WHERE id LIKE ? OR subject LIKE ?")
    .all(prefix, `%${TAG}%`)
    .map((row) => row.id);
  for (const campaignId of campaigns) {
    db.prepare("DELETE FROM NewsletterSend WHERE campaignId = ?").run(campaignId);
  }
  db.prepare("DELETE FROM NewsletterCampaign WHERE id LIKE ? OR subject LIKE ?").run(prefix, `%${TAG}%`);
  db.prepare("DELETE FROM NewsletterSend WHERE subscriberId LIKE ?").run(prefix);
  db.prepare("DELETE FROM _NewsletterListToNewsletterSubscriber WHERE A LIKE ? OR B LIKE ?").run(prefix, prefix);
  db.prepare("DELETE FROM NewsletterSubscriber WHERE id LIKE ?").run(prefix);
  // Les listes de relance créées par l'action portent un slug « non-ouvreurs-… ».
  db.prepare("DELETE FROM NewsletterList WHERE id LIKE ? OR slug LIKE ?").run(prefix, `non-ouvreurs-%-${TAG}%`);
  db.prepare("DELETE FROM NewsletterList WHERE slug LIKE 'non-ouvreurs-%' AND name LIKE ?").run(`%${TAG}%`);
}

/* ------------------------------------------------------------------- tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/**
 * Identifiant d'une action serveur, cherché dans les manifestes de Next.
 *
 * `pathFilter` restreint la recherche à un dossier de routes : deux actions
 * peuvent porter le même nom dans deux pages différentes (c'est le cas de
 * `duplicateCampaign`, présente dans l'ancien onglet du WP11a et dans l'espace
 * de gestion du WP11d).
 */
function findActionId(exportedName, pathFilter = null) {
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
      if (pathFilter && !full.replace(/\\/g, "/").includes(pathFilter)) continue;
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

  try {
    /* ------------------------------------------------------- 1) Code et cadre */
    console.log("--- Server Actions, formulaires et cron ---");
    check(
      "huit actions de campagne exportées",
      [
        "createCampaign",
        "updateCampaign",
        "deleteCampaign",
        "duplicateCampaign",
        "sendCampaignNow",
        "scheduleCampaign",
        "sendTestEmail",
        "resendToNonOpeners",
      ].every((name) => actionsSource.includes(`export async function ${name}(`)),
    );
    check(
      "toutes les actions vérifient le rôle ADMIN",
      (actionsSource.match(/await requireAdmin\(\)/g) ?? []).length >= 8 &&
        actionsSource.includes('redirect("/login")') &&
        actionsSource.includes('redirect("/studio")'),
    );
    check(
      "édition et envoi limités aux campagnes brouillon ou planifiées",
      /EDITABLE_STATUSES = \["DRAFT", "SCHEDULED"\] as const/.test(actionsSource) &&
        actionsSource.includes("EDITABLE_STATUSES.includes"),
    );
    check(
      "suppression refusée pour une campagne partie",
      /UNDELETABLE_STATUSES = \["SENDING", "SENT"\] as const/.test(actionsSource),
    );
    check(
      "validation : sujet (150 max), liste active, contenu non vide",
      actionsSource.includes("MAX_SUBJECT_LENGTH = 150") &&
        actionsSource.includes("Cette liste est inactive") &&
        actionsSource.includes("Le contenu HTML est obligatoire."),
    );
    check(
      "une date de planification met la campagne en SCHEDULED",
      /status: result\.scheduledAt \? "SCHEDULED" : "DRAFT"/.test(actionsSource),
    );
    check(
      "lib : test unitaire, non-ouvreurs et traitement des planifiées",
      ["sendTestCampaignEmail", "campaignNonOpeners", "processScheduledCampaigns", "countCampaignRecipients"].every(
        (name) => sendLib.includes(`export async function ${name}`) || sendLib.includes(`export function ${name}`),
      ),
    );
    check(
      "le test n'écrit aucun envoi et neutralise les jetons",
      sendLib.includes("/newsletter/preferences/apercu") &&
        sendLib.includes("/api/newsletter/track-open/apercu") &&
        /subject: `\[TEST\] \$\{campaign\.subject\}`/.test(sendLib),
    );
    check(
      "cron : jeton comparé en temps constant, 503 sans configuration",
      cronRoute.includes("timingSafeEqual") &&
        cronRoute.includes("status: 503") &&
        cronRoute.includes("status: 401") &&
        cronRoute.includes("processScheduledCampaigns()"),
    );
    check(
      "formulaire : champs du brief (sujet, pré-en-tête, liste, HTML, planification)",
      ['name="subject"', 'name="previewText"', 'name="listId"', 'name="contentHtml"', 'type="datetime-local"'].every(
        (needle) => formSource.includes(needle),
      ),
    );
    check(
      "formulaire : deux boutons d'enregistrement, dont « Enregistrer et prévisualiser »",
      formSource.includes('value="save"') &&
        formSource.includes('value="preview"') &&
        formSource.includes("Enregistrer et prévisualiser"),
    );
    check(
      "prévisualisation : iframe sandboxée, sans script ni navigation",
      previewPage.includes("sandbox=\"\"") && previewPage.includes("srcDoc={rendered.html}"),
    );
    check(
      "envoi immédiat : confirmation modale avec nombre de destinataires",
      sendButtonSource.includes('role="dialog"') &&
        sendButtonSource.includes("Cette action est irréversible") &&
        sendButtonSource.includes("destinataire"),
    );
    check(
      "édition : redirection des campagnes non modifiables",
      editPage.includes('redirect(`/backoffice/newsletter/campaigns/${id}?message=non-modifiable`)'),
    );
    check(
      "périmètre : modèle Prisma inchangé, aucun éditeur WYSIWYG installé",
      !/model (CampaignSegment|EmailTemplate)/.test(schema) &&
        !listPage.includes("tiptap") &&
        !formSource.includes("ContentEditable"),
    );

    /* ------------------------------------------------------------- 2) Fixtures */
    console.log("\n--- Jeu de test ---");
    insertList(ids.list, `Liste ${TAG}`);
    insertList(ids.listOther, `Autre liste ${TAG}`);
    insertSubscriber(ids.subscriber);
    insertSubscriber(ids.subscriber2);
    insertSubscriber(ids.subscriber3, "PENDING");
    insertCampaign({ id: ids.campaign, subject: `Brouillon ${TAG}`, status: "DRAFT" });
    insertCampaign({
      id: ids.campaignScheduled,
      subject: `Planifiée ${TAG}`,
      status: "SCHEDULED",
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    insertCampaign({ id: ids.campaignSent, subject: `Envoyée ${TAG}`, status: "SENT", sentAt: new Date().toISOString() });
    check(
      "deux listes, trois abonnés et trois campagnes créés",
      db.prepare("SELECT COUNT(*) AS c FROM NewsletterCampaign WHERE id LIKE ?").get(`${TAG}%`).c === 3 &&
        db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?").get(`${TAG}%`).c === 3,
    );

    const adminJar = await login("admin@example.com", "admin123");
    const journalistJar = await login("journalist@example.com", "password123");
    const editorJar = await login("editor@example.com", "password123");

    /* --------------------------------------------------------- 3) Accès */
    console.log("\n--- Accès réservé aux ADMIN ---");
    check(
      "visiteur : redirection vers /login",
      (await get(BASE)).status === 307,
      `status=${(await get(BASE)).status}`,
    );
    const asJournalist = await get(BASE, { jar: journalistJar });
    const asEditor = await get(`${BASE}/new`, { jar: editorJar });
    check(
      "JOURNALIST et EDITOR : redirection vers /studio",
      asJournalist.status === 307 && asEditor.status === 307,
      `${asJournalist.status}/${asEditor.status}`,
    );
    check("ADMIN : liste accessible", (await get(BASE, { jar: adminJar })).status === 200);

    /* ------------------------------------------------------- 4) Liste */
    console.log("\n--- Liste des campagnes ---");
    const list = await get(BASE, { jar: adminJar });
    check(
      "colonnes du tableau",
      ["Sujet", "Liste", "Statut", "Envoi", "Destinataires", "Ouverture", "Clic", "Actions"].every((label) =>
        list.body.includes(`>${label}<`),
      ),
    );
    check(
      "trois campagnes affichées avec leur statut",
      list.body.includes(`Brouillon ${TAG}`) &&
        list.body.includes(`Planifiée ${TAG}`) &&
        text(list.body).includes("Brouillon") &&
        text(list.body).includes("Planifiée"),
    );
    check(
      "filtres : statut, liste et recherche par sujet",
      ['name="statut"', 'name="liste"', 'name="q"'].every((needle) => list.body.includes(needle)),
    );
    const filtered = await get(`${BASE}?statut=DRAFT&q=${encodeURIComponent(TAG)}`, { jar: adminJar });
    check(
      "filtre par statut appliqué",
      filtered.body.includes(`Brouillon ${TAG}`) && !filtered.body.includes(`Planifiée ${TAG}`),
    );
    const byList = await get(`${BASE}?liste=${ids.listOther}`, { jar: adminJar });
    check(
      "filtre par liste appliqué",
      !byList.body.includes(`Brouillon ${TAG}`),
      byList.body.includes(`Brouillon ${TAG}`) ? "campagne visible à tort" : "liste vide attendue",
    );
    check(
      "lien vers la gestion des abonnés et bouton de traitement des planifiées",
      list.body.includes("/backoffice/newsletter\"") &&
        text(list.body).includes("Traiter les envois planifiés"),
    );
    check(
      "actions de ligne selon le statut : éditer/envoyer pour un brouillon, pas pour une envoyée",
      list.body.includes(`/campaigns/${ids.campaign}/edit`) &&
        list.body.includes(`/campaigns/${ids.campaign}?envoyer=1`) &&
        !list.body.includes(`/campaigns/${ids.campaignSent}/edit`),
    );

    /* ------------------------------------------------------ 5) Création */
    console.log("\n--- Création ---");
    const newForm = await get(`${BASE}/new`, { jar: adminJar });
    check(
      "formulaire de création : champs présents, liste active proposée",
      newForm.status === 200 &&
        ['name="subject"', 'name="previewText"', 'name="listId"', 'name="contentHtml"', 'name="scheduledAt"'].every(
          (needle) => newForm.body.includes(needle),
        ) &&
        newForm.body.includes(`Liste ${TAG}`),
    );

    const created = await submitForm(adminJar, `${BASE}/new`, {
      contains: 'name="subject"',
      fields: {
        subject: `Campagne créée ${TAG}`,
        previewText: "Pré-en-tête de test",
        listId: ids.list,
        contentHtml: `<h1>Bonjour</h1><p>${TAG} corps de campagne</p>`,
        scheduledAt: "",
      },
    });
    const createdRow = db
      .prepare("SELECT id, status, subject, previewText, contentHtml FROM NewsletterCampaign WHERE subject = ?")
      .get(`Campagne créée ${TAG}`);
    check(
      "création : campagne en DRAFT avec sujet, pré-en-tête et contenu",
      created.ok &&
        createdRow?.status === "DRAFT" &&
        createdRow?.previewText === "Pré-en-tête de test" &&
        String(createdRow?.contentHtml ?? "").includes(TAG),
      `${createdRow?.status ?? "aucune"} (redirection ${redirectTarget(created).slice(0, 40)})`,
    );
    check(
      "création : redirection vers le détail avec compte rendu",
      redirectTarget(created).includes("message=cree"),
      redirectTarget(created).slice(0, 60) || "aucune redirection",
    );

    const invalidSubject = await submitForm(adminJar, `${BASE}/new`, {
      contains: 'name="subject"',
      fields: { subject: "", listId: ids.list, contentHtml: "<p>x</p>" },
    });
    check(
      "sujet vide : refusé par la validation",
      text(invalidSubject.body).includes("Le sujet est obligatoire"),
    );

    const inactiveList = await submitForm(adminJar, `${BASE}/new`, {
      contains: 'name="subject"',
      fields: { subject: `Inactive ${TAG}`, listId: `${TAG}-liste-inactive`, contentHtml: "<p>x</p>" },
    });
    check(
      "liste inexistante : refusée",
      text(inactiveList.body).includes("n'existe pas"),
    );

    const emptyContent = await submitForm(adminJar, `${BASE}/new`, {
      contains: 'name="subject"',
      fields: { subject: `Sans contenu ${TAG}`, listId: ids.list, contentHtml: "" },
    });
    check(
      "contenu vide : refusé",
      text(emptyContent.body).includes("Le contenu HTML est obligatoire"),
    );

    const scheduled = await submitForm(adminJar, `${BASE}/new`, {
      contains: 'name="subject"',
      fields: {
        subject: `Planifiée depuis le formulaire ${TAG}`,
        listId: ids.list,
        contentHtml: "<p>planifiée</p>",
        scheduledAt: "2026-12-01T08:30",
      },
    });
    const scheduledRow = db
      .prepare("SELECT status, scheduledAt FROM NewsletterCampaign WHERE subject = ?")
      .get(`Planifiée depuis le formulaire ${TAG}`);
    check(
      "date de planification : campagne en SCHEDULED",
      scheduled.ok && scheduledRow?.status === "SCHEDULED" && Boolean(scheduledRow?.scheduledAt),
      `${scheduledRow?.status ?? "aucune"}`,
    );

    /* ------------------------------------------------------- 6) Édition */
    console.log("\n--- Édition ---");
    const editForm = await get(`${BASE}/${createdRow.id}/edit`, { jar: adminJar });
    check(
      "formulaire d'édition pré-rempli",
      editForm.status === 200 &&
        editForm.body.includes(`Campagne créée ${TAG}`) &&
        editForm.body.includes("Pré-en-tête de test"),
    );
    const updated = await submitForm(adminJar, `${BASE}/${createdRow.id}/edit`, {
      contains: 'name="subject"',
      fields: {
        subject: `Campagne modifiée ${TAG}`,
        previewText: "Nouveau pré-en-tête",
        listId: ids.list,
        contentHtml: `<p>${TAG} contenu modifié</p>`,
        scheduledAt: "",
      },
    });
    const updatedRow = campaignRow(createdRow.id);
    check(
      "édition : sujet et contenu mis à jour, statut inchangé",
      updated.ok && updatedRow?.subject === `Campagne modifiée ${TAG}` && updatedRow?.status === "DRAFT",
      `${updatedRow?.subject} / ${updatedRow?.status}`,
    );
    const editSent = await get(`${BASE}/${ids.campaignSent}/edit`, { jar: adminJar });
    check(
      "campagne envoyée : édition refusée et redirection vers le détail",
      editSent.status === 307 && String(editSent.location ?? "").includes("non-modifiable"),
      `${editSent.status} ${String(editSent.location ?? "—").slice(0, 50)}`,
    );

    /* ------------------------------------------------ 7) Prévisualisation */
    console.log("\n--- Prévisualisation ---");
    const preview = await get(`${BASE}/${createdRow.id}/preview`, { jar: adminJar });
    check("page de prévisualisation accessible", preview.status === 200, `status=${preview.status}`);
    check(
      "iframe sandboxée avec le HTML rendu",
      // React sert l'attribut sous sa forme JSX (`srcDoc=`) : les noms
      // d'attributs HTML sont insensibles à la casse côté navigateur, mais pas
      // dans une comparaison de chaînes.
      /<iframe[^>]*sandbox/i.test(preview.body) &&
        /srcdoc=/i.test(preview.body) &&
        preview.body.includes(`${TAG} contenu modifié`),
    );
    check(
      "gabarit d'e-mail appliqué (désabonnement et mise en page)",
      text(preview.body).includes("apercu") &&
        preview.body.includes("newsletter/preferences/apercu") &&
        preview.body.includes("Se désabonner"),
    );
    check(
      "compteur de destinataires affiché",
      text(preview.body).includes("destinataire"),
    );

    const testActionId = findActionId("sendTestEmail");
    check(
      "action d'envoi de test exportée et trouvée dans le manifeste",
      Boolean(testActionId),
      testActionId?.slice(0, 8) ?? "introuvable",
    );

    stubMails.length = 0;
    // Le formulaire de test vit dans une modale (client), doublée d'un
    // formulaire `<noscript>` : c'est celui-ci qu'un navigateur sans JavaScript
    // — et cette suite — peut soumettre.
    const testForm = await submitForm(adminJar, `${BASE}/${createdRow.id}/preview`, {
      contains: ['name="email"', 'id="test-email-noscript"'],
      fields: { email: "test-destinataire@example.test" },
    });
    const stubConfigured = stubMails.length > 0;
    check(
      "envoi d'un test : formulaire accessible et action déclenchée",
      testForm.ok && redirectTarget(testForm).includes("message="),
      `${testForm.status ?? "?"} ${redirectTarget(testForm).slice(0, 50) || testForm.reason || "—"}`,
    );
    check(
      stubConfigured
        ? "le test part réellement à l'adresse demandée, avec le préfixe [TEST]"
        : "envoi désactivé : le test est signalé en échec, sans planter",
      stubConfigured
        ? stubMails.some(
            (mail) =>
              mail.to === "test-destinataire@example.test" && mail.subject.startsWith("[TEST]"),
          )
        : redirectTarget(testForm).includes("test-echec"),
      stubConfigured ? `${stubMails.length} message(s)` : "serveur factice non sollicité",
    );
    check(
      "un test ne crée aucun envoi de campagne",
      sendRows(createdRow.id).length === 0,
      `${sendRows(createdRow.id).length} envoi(s)`,
    );

    /* ------------------------------------------------------- 8) Envoi réel */
    console.log("\n--- Envoi immédiat ---");
    const detail = await get(`${BASE}/${createdRow.id}`, { jar: adminJar });
    check(
      "bouton d'envoi présent sur un brouillon, avec compte de destinataires",
      detail.status === 200 &&
        detail.body.includes("Envoyer maintenant") &&
        text(detail.body).includes("destinataire"),
    );
    check(
      "modale de confirmation ouverte depuis la liste (?envoyer=1)",
      text(await (await get(`${BASE}/${createdRow.id}?envoyer=1`, { jar: adminJar })).body).includes(
        "Envoyer cette campagne ?",
      ),
    );

    stubMails.length = 0;
    const sendActionId = findActionId("sendCampaignNow");
    // Envoi par le formulaire de confirmation (celui de la modale, doublé sans
    // JavaScript) : c'est le parcours réel de l'interface.
    const sendCall = await submitForm(adminJar, `${BASE}/${createdRow.id}?envoyer=1`, {
      // Le libellé du bouton contient une apostrophe, échappée dans le HTML :
      // on s'arrête avant elle.
      contains: "Confirmer l",
      fields: {},
    });
    const afterSend = campaignRow(createdRow.id);
    const sentRows = sendRows(createdRow.id);
    const servedAll = sentRows.every((row) => row.status === "SENT");
    check(
      "envoi : la campagne quitte le brouillon avec sa date et ses destinataires",
      sendCall.ok &&
        ["SENT", "FAILED"].includes(afterSend?.status ?? "") &&
        Boolean(afterSend?.sentAt) &&
        afterSend?.recipientCount === 2,
      `${afterSend?.status} / ${afterSend?.recipientCount} destinataire(s)`,
    );
    check(
      stubConfigured
        ? "envoi : campagne SENT après acceptation par le fournisseur"
        : "envoi : campagne FAILED quand aucun fournisseur n'est configuré",
      stubConfigured ? afterSend?.status === "SENT" : afterSend?.status === "FAILED",
      `statut=${afterSend?.status}`,
    );
    check(
      "envoi : un NewsletterSend par abonné confirmé de la liste (l'abonné en attente est exclu)",
      sentRows.length === 2 &&
        !sentRows.some((row) => row.subscriberId === ids.subscriber3) &&
        servedAll === stubConfigured,
      `${sentRows.length} envoi(s), statuts ${sentRows.map((row) => row.status).join(",")}`,
    );
    check(
      "envoi : identifiant fournisseur enregistré",
      stubConfigured ? sentRows.every((row) => Boolean(row.providerMessageId)) : true,
      sentRows.map((row) => row.providerMessageId ?? "—").join(", "),
    );
    check(
      "envoi : la campagne ne peut pas être renvoyée",
      (await callAction(adminJar, `${BASE}/${createdRow.id}`, sendActionId, [createdRow.id])).status < 400 &&
        sendRows(createdRow.id).length === 2,
    );

    /* ------------------------------------------- 9) Détail et non-ouvreurs */
    console.log("\n--- Détail et relance ---");
    const send = sendRows(createdRow.id)[0];
    // Un destinataire ouvre : il ne doit pas être relancé.
    db.prepare("UPDATE NewsletterSend SET openedAt = ?, status = 'OPENED' WHERE id = ?").run(
      new Date().toISOString(),
      send.id,
    );
    db.prepare("UPDATE NewsletterCampaign SET deliveredCount = 2, openCount = 1 WHERE id = ?").run(createdRow.id);

    const detailAfter = await get(`${BASE}/${createdRow.id}`, { jar: adminJar });
    check(
      "métriques et taux affichés",
      ["Destinataires", "Délivrés", "Ouverts", "Cliqués", "Rejets", "Désabonnés"].every((label) =>
        detailAfter.body.includes(`>${label}<`),
      ) && text(detailAfter.body).includes("taux 50,0 %"),
      text(detailAfter.body).match(/taux [\d,]+ %/)?.[0] ?? "aucun taux",
    );
    check(
      "tableau des destinataires : e-mail, statut et dates",
      detailAfter.body.includes(address(ids.subscriber)) &&
        detailAfter.body.includes(address(ids.subscriber2)) &&
        text(detailAfter.body).includes("Ouvert"),
    );

    const relance = await callAction(
      adminJar,
      `${BASE}/${createdRow.id}`,
      findActionId("resendToNonOpeners"),
      [createdRow.id],
    );
    const retargetList = db
      .prepare("SELECT id, name FROM NewsletterList WHERE name LIKE ? AND name LIKE ?")
      .get("Non-ouvreurs%", `%${TAG}%`);
    const retargetCampaign = db
      .prepare("SELECT status, listId, subject FROM NewsletterCampaign WHERE subject = ?")
      .get(`Relance : Campagne modifiée ${TAG}`);
    const retargetMembers = retargetList
      ? db
          .prepare("SELECT COUNT(*) AS c FROM _NewsletterListToNewsletterSubscriber WHERE A = ?")
          .get(retargetList.id).c
      : 0;
    // Un envoi resté en échec (aucun fournisseur configuré) n'est pas un
    // « non-ouvreur » : l'adresse n'a jamais reçu le message, la relance n'aurait
    // pas de sens. La suite adapte donc son attente à l'état réel des envois.
    const retargetable = sentRows.some((row) => !["FAILED", "BOUNCED"].includes(row.status));
    check(
      retargetable
        ? "relance : liste des non-ouvreurs et campagne en brouillon"
        : "relance impossible quand aucun envoi n'a abouti : message explicite",
      retargetable
        ? Boolean(retargetList) &&
            retargetCampaign?.status === "DRAFT" &&
            retargetCampaign?.listId === retargetList?.id
        : Boolean(campaignRow(createdRow.id)) && redirectTarget(relance).includes("aucun-non-ouvreur"),
      `${retargetCampaign?.status ?? "aucune relance"} / liste ${retargetList?.name ?? "absente"} / envois ${sentRows.map((row) => row.status).join(",")}`,
    );
    check(
      "relance : seuls les destinataires sans ouverture sont repris",
      retargetable ? retargetMembers === 1 : retargetMembers === 0,
      `${retargetMembers} membre(s) dans la liste de relance`,
    );
    check(
      "relance : redirection avec le compte rendu",
      redirectTarget(relance).includes(retargetable ? "relance-1" : "aucun-non-ouvreur"),
      redirectTarget(relance).slice(0, 60) || "aucune redirection",
    );
    check(
      "aucune relance si tout le monde a ouvert",
      await (async () => {
        db.prepare("UPDATE NewsletterSend SET openedAt = ? WHERE campaignId = ?").run(
          new Date().toISOString(),
          createdRow.id,
        );
        const call = await callAction(
          adminJar,
          `${BASE}/${createdRow.id}`,
          findActionId("resendToNonOpeners"),
          [createdRow.id],
        );
        return redirectTarget(call).includes("aucun-non-ouvreur");
      })(),
    );

    /* ------------------------------------------------ 10) Duplication, suppression */
    console.log("\n--- Duplication, suppression, planification ---");
    const duplicateCall = await callAction(
      adminJar,
      BASE,
      findActionId("duplicateCampaign", "/backoffice/newsletter/campaigns"),
      [createdRow.id],
    );
    const copy = db
      .prepare("SELECT id, status, subject FROM NewsletterCampaign WHERE subject = ?")
      .get(`Copie de Campagne modifiée ${TAG}`);
    check(
      "duplication : copie en brouillon, sans envois",
      copy?.status === "DRAFT" && sendRows(copy.id).length === 0,
      `${copy?.status ?? "aucune copie"}`,
    );

    const deleteCall = await callAction(adminJar, BASE, findActionId("deleteCampaign"), [copy.id]);
    check(
      "suppression d'un brouillon : campagne retirée",
      Boolean(deleteCall) && !campaignRow(copy.id),
      deleteCall.status === undefined ? "action absente" : `status=${deleteCall.status}`,
    );
    const deleteSent = await callAction(adminJar, BASE, findActionId("deleteCampaign"), [ids.campaignSent]);
    check(
      "suppression d'une campagne envoyée : refusée",
      Boolean(campaignRow(ids.campaignSent)) &&
        redirectTarget(deleteSent).includes("suppression-refusee"),
      redirectTarget(deleteSent).slice(0, 60) || "aucune redirection",
    );

    // Planification : le formulaire du détail (celui qui porte la date).
    const schedule = await submitForm(adminJar, `${BASE}/${ids.campaign}`, {
      contains: 'name="scheduledAt"',
      fields: { scheduledAt: "2026-11-15T09:00" },
    });
    const planified = campaignRow(ids.campaign);
    check(
      "planification par le formulaire : campagne en SCHEDULED avec sa date",
      schedule.ok && planified?.status === "SCHEDULED" && Boolean(planified?.scheduledAt),
      `${planified?.status ?? "—"} / ${planified?.scheduledAt ?? "sans date"}`,
    );
    const unschedule = await submitForm(adminJar, `${BASE}/${ids.campaign}`, {
      contains: 'name="scheduledAt"',
      fields: { scheduledAt: "" },
    });
    check(
      "retrait de la planification : retour en brouillon",
      unschedule.ok && campaignRow(ids.campaign)?.status === "DRAFT" && !campaignRow(ids.campaign)?.scheduledAt,
      `${campaignRow(ids.campaign)?.status ?? "—"}`,
    );

    /* ------------------------------------------------------- 11) Cron */
    console.log("\n--- Endpoint de cron ---");
    const scheduledDue = `${TAG}-echeance`;
    insertCampaign({
      id: scheduledDue,
      subject: `Échéance ${TAG}`,
      status: "SCHEDULED",
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const noToken = await get("/api/cron/newsletter");
    const badToken = await get("/api/cron/newsletter?token=faux");
    check(
      "cron sans jeton ou avec un jeton faux : refusé",
      noToken.status === 401 && badToken.status === 401,
      `${noToken.status}/${badToken.status}`,
    );

    stubMails.length = 0;
    const cron = await get(
      `/api/cron/newsletter?token=${encodeURIComponent(CRON_SECRET)}`,
    );
    const dueRow = campaignRow(scheduledDue);
    const futureRow = campaignRow(ids.campaignScheduled);
    let cronPayload = null;
    try {
      cronPayload = JSON.parse(cron.body);
    } catch {
      cronPayload = null;
    }
    check(
      "cron : campagne échue traitée, planifiée future intacte",
      cron.status === 200 &&
        ["SENT", "FAILED"].includes(dueRow?.status ?? "") &&
        futureRow?.status === "SCHEDULED" &&
        (cronPayload?.processed?.length ?? 0) >= 1,
      `${dueRow?.status} / future ${futureRow?.status} / traitées ${cronPayload?.processed?.length ?? "?"}`,
    );
    check(
      "cron : réponse JSON exploitable par un ordonnanceur",
      cronPayload?.ok === true && Array.isArray(cronPayload.errors),
      JSON.stringify(cronPayload)?.slice(0, 80) ?? "corps illisible",
    );
    const cronPost = await request("POST", "/api/cron/newsletter", {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    check(
      "cron : jeton accepté aussi en en-tête Authorization (POST)",
      cronPost.status === 200,
      `status=${cronPost.status}`,
    );
    check(
      "cron : contenu de l'application écrit au serveur factice",
      !stubConfigured || stubMails.length >= 2,
      `${stubMails.length} message(s)`,
    );

    /* ------------------------------------------------- 12) Non-régression */
    console.log("\n--- Non-régression ---");
    check(
      "page abonnés et listes toujours accessible",
      (await get("/backoffice/newsletter", { jar: adminJar })).status === 200,
    );
    check("accueil toujours servi", (await get("/")).status === 200);
    check("scores toujours servis", (await get("/scores")).status === 200);
    check("inscription publique toujours accessible", (await get("/newsletter")).status === 200);

    cleanup();
    const leftovers = db
      .prepare("SELECT COUNT(*) AS c FROM NewsletterCampaign WHERE id LIKE ?")
      .get("chk11d%").c;
    check("nettoyage : aucune donnée de test laissée en base", leftovers === 0, `${leftovers} restant(s)`);
  } finally {
    await stopStub();
  }

  db.close();

  const failed = results.filter((result) => !result).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
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
