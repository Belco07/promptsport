/**
 * Vérification du WP11a — couche de données de la newsletter.
 * Exécution : PORT=3002 node scripts/check-wp11a.cjs
 *
 * Cinq niveaux :
 *  1. schéma, enums, migration et tables réellement créées ;
 *  2. helpers (`src/lib/newsletter.ts`) ;
 *  3. contraintes d'unicité en base (email, (campagne, abonné), compte lié) ;
 *  4. page /backoffice/newsletter : accès par rôle, onglets, statistiques,
 *     tableaux, panneaux de détail, pagination ;
 *  5. actions (désabonner, dupliquer) et respect du périmètre (aucun envoi
 *     d'e-mail, aucun formulaire public, aucune bibliothèque ajoutée).
 *
 * Les données créées sont préfixées « chk11a » et supprimées à la fin.
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

const dbUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(ROOT, dbUrl.replace(/^file:(\/\/)?/, "")));
db.pragma("foreign_keys = ON");

const readSource = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const schema = readSource("prisma/schema.prisma");
const newsletter = readSource("src/lib/newsletter.ts");
const page = readSource("src/app/backoffice/newsletter/page.tsx");
const actions = readSource("src/app/backoffice/newsletter/actions.ts");
const subscribersTab = readSource("src/app/backoffice/newsletter/components/SubscribersTab.tsx");
const campaignsTab = readSource("src/app/backoffice/newsletter/components/CampaignsTab.tsx");
const subscriberDetail = readSource("src/app/backoffice/newsletter/components/SubscriberDetail.tsx");
const campaignDetail = readSource("src/app/backoffice/newsletter/components/CampaignDetail.tsx");
const backofficeNav = readSource("src/app/backoffice/BackofficeNav.tsx");
const backofficePage = readSource("src/app/backoffice/page.tsx");
const packageJson = JSON.parse(readSource("package.json"));

// WP12a : les migrations SQLite ont été remplacées par la migration unique
// `init_postgres`, qui contient désormais les tables de la newsletter.
const MIGRATION = "prisma/migrations/20261002120000_init_postgres/migration.sql";
const MODELS = [
  "NewsletterSubscriber",
  "NewsletterList",
  "NewsletterCampaign",
  "NewsletterSend",
];
const BASE_PATH = "/backoffice/newsletter";
const SUBSCRIBER_STATUSES = ["PENDING", "CONFIRMED", "UNSUBSCRIBED", "BOUNCED"];
const CAMPAIGN_STATUSES = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "CANCELLED", "FAILED"];
const SEND_STATUSES = ["PENDING", "SENT", "DELIVERED", "OPENED", "CLICKED", "BOUNCED", "FAILED"];

const TAG = `chk11a-${crypto.randomBytes(4).toString("hex")}`;
const ids = {
  listPrimary: `${TAG}-list-hebdo`,
  listSecondary: `${TAG}-list-mercato`,
  campaignSent: `${TAG}-camp-envoyee`,
  campaignDraft: `${TAG}-camp-brouillon`,
  subscriberConfirmed: `${TAG}-sub-confirme`,
  subscriberPending: `${TAG}-sub-attente`,
  subscriberUnsubscribed: `${TAG}-sub-desabonne`,
  subscriberBounced: `${TAG}-sub-invalide`,
  bulk: Array.from(
    { length: 28 },
    (_, index) => `${TAG}-sub-masse-${String(index + 1).padStart(2, "0")}`,
  ),
};
const bulkEmail = (id) => `${id}@example.test`;

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

async function login(email, password, callbackPath = BASE_PATH) {
  const jar = createJar();
  await get("/login", { jar });
  const csrfBody = (await get("/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(`Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF).`);
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}${callbackPath}` },
  });
  return jar;
}

/** Appel direct d'une Server Action (protocole Next-Action), comme le client. */
function callAction(jar, pagePath, actionIdValue, args = []) {
  return request("POST", pagePath, {
    jar,
    raw: JSON.stringify(args),
    contentType: "text/plain;charset=UTF-8",
    headers: { "next-action": actionIdValue, origin: ORIGIN },
  });
}

/** Parcourt les manifestes des actions serveur et retourne l'identifiant voulu. */
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

/** Champs cachés du premier formulaire contenant l'extrait demandé. */
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

/** Champs d'un formulaire d'action liée (`.bind`), repéré par son argument lié. */
function boundFormFields(html, id) {
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

/** Soumet un formulaire d'action liée en multipart, comme un navigateur. */
async function submitBoundForm(jar, urlPath, boundArg) {
  const current = await get(urlPath, { jar });
  const fields = boundFormFields(current.body, boundArg);
  if (!fields) return { ok: false, reason: `formulaire lié introuvable (${boundArg})` };

  const boundary = `----WP11A${crypto.randomBytes(8).toString("hex")}`;
  const parts = Object.entries(fields).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const response = await request("POST", urlPath, {
    jar,
    raw: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
    headers: { origin: ORIGIN, referer: `${ORIGIN}${urlPath}` },
  });
  return { ok: response.status < 400, status: response.status, location: response.location };
}

/** Texte débarrassé des marqueurs de commentaire insérés par React. */
const text = (html) => html.replace(/<!-- -->/g, "");

/**
 * Soumet un formulaire repéré par un extrait, avec des champs supplémentaires —
 * les formulaires de liste (nom, description, activation) ne sont pas des actions
 * liées : leurs champs sont saisis, pas cachés.
 */
async function submitFields(jar, urlPath, contains, fields) {
  const current = await get(urlPath, { jar });
  const harvested = formFields(current.body, contains);
  if (!harvested) return { ok: false, reason: `formulaire introuvable (${contains})` };

  const boundary = `----WP11A${crypto.randomBytes(8).toString("hex")}`;
  const entries = { ...harvested, ...fields };
  const parts = [];
  for (const [name, value] of Object.entries(entries)) {
    for (const single of [].concat(value)) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${single}\r\n`,
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
  return { ok: response.status < 400, status: response.status, location: response.location };
}

/* ---------------------------------------------------------------- fixtures */

function createUser(id, name, role) {
  db.prepare(
    `INSERT INTO Author (id, name, email, passwordHash, role, isPremium, slug, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, name, `${id}@example.test`, bcrypt.hashSync("password123", 10), role, id, new Date().toISOString());
}

const insertSubscriber = db.prepare(
  `INSERT INTO NewsletterSubscriber
     (id, email, name, status, confirmationToken, confirmedAt, unsubscribedAt, userId, source, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

function insertList(id, name, active = 1) {
  db.prepare(
    `INSERT INTO NewsletterList (id, name, slug, description, active, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, id, `Liste de test ${TAG}`, active, new Date().toISOString(), new Date().toISOString());
}

function insertCampaign({
  id,
  listId,
  subject,
  status,
  createdById,
  sentAt = null,
  scheduledAt = null,
  contentHtml = `<b>${TAG}</b>`,
  previewText = null,
  recipientCount = 0,
  deliveredCount = 0,
  openCount = 0,
  clickCount = 0,
  bounceCount = 0,
  createdAt = new Date().toISOString(),
}) {
  db.prepare(
    `INSERT INTO NewsletterCampaign
       (id, listId, subject, previewText, contentHtml, contentText, status, scheduledAt, sentAt,
        recipientCount, deliveredCount, openCount, clickCount, bounceCount, createdById, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    listId,
    subject,
    previewText,
    contentHtml,
    status,
    scheduledAt,
    sentAt,
    recipientCount,
    deliveredCount,
    openCount,
    clickCount,
    bounceCount,
    createdById,
    createdAt,
    createdAt,
  );
}

function insertSend(id, campaignId, subscriberId, status, extra = {}) {
  db.prepare(
    `INSERT INTO NewsletterSend
       (id, campaignId, subscriberId, status, sentAt, deliveredAt, openedAt, clickedAt, errorMessage, providerMessageId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
  ).run(
    id,
    campaignId,
    subscriberId,
    status,
    extra.sentAt ?? null,
    extra.errorMessage ?? null,
    extra.createdAt ?? new Date().toISOString(),
    extra.createdAt ?? new Date().toISOString(),
  );
}

function cleanup() {
  db.prepare("DELETE FROM NewsletterSend WHERE campaignId LIKE ?").run(`${TAG}%`);
  db.prepare("DELETE FROM NewsletterCampaign WHERE id LIKE ? OR subject LIKE ?").run(`${TAG}%`, `%${TAG}%`);
  db.prepare("DELETE FROM NewsletterSend WHERE subscriberId LIKE ?").run(`${TAG}%`);
  db.prepare("DELETE FROM _NewsletterListToNewsletterSubscriber WHERE A LIKE ? OR B LIKE ?").run(
    `${TAG}%`,
    `${TAG}%`,
  );
  db.prepare("DELETE FROM NewsletterSubscriber WHERE id LIKE ? OR email LIKE ?").run(`${TAG}%`, `${TAG}%`);
  db.prepare("DELETE FROM NewsletterList WHERE id LIKE ?").run(`${TAG}%`);
  db.prepare("DELETE FROM Author WHERE id LIKE ?").run(`${TAG}%`);
}

/* ------------------------------------------------------------------- tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

const subscriberRow = (id) =>
  db
    .prepare("SELECT status, unsubscribedAt, confirmedAt, userId FROM NewsletterSubscriber WHERE id = ?")
    .get(id);

async function main() {
  cleanup();

  /* -------------------------------------------------- 1) Schéma et migration */
  console.log("--- Schéma, enums et migration ---");
  check(
    "quatre modèles déclarés",
    MODELS.every((model) => schema.includes(`model ${model} {`)),
    MODELS.filter((model) => !schema.includes(`model ${model} {`)).join(", ") || "tous présents",
  );
  check(
    "enum SubscriberStatus (4 valeurs)",
    schema.includes("enum SubscriberStatus {") &&
      SUBSCRIBER_STATUSES.every((value) => schema.includes(value)),
  );
  check(
    "enum CampaignStatus (6 valeurs)",
    schema.includes("enum CampaignStatus {") &&
      CAMPAIGN_STATUSES.every((value) => schema.includes(value)),
  );
  check(
    "enum SendStatus (7 valeurs)",
    schema.includes("enum SendStatus {") && SEND_STATUSES.every((value) => schema.includes(value)),
  );

  const authorBlock = schema.slice(schema.indexOf("model Author {"), schema.indexOf("enum UserRole"));
  check(
    "Author : relation optionnelle vers l'abonné",
    /newsletterSubscriber\s+NewsletterSubscriber\?/.test(authorBlock),
  );
  check(
    "Author : campagnes créées, relation nommée CampaignAuthor",
    /newsletterCampaigns\s+NewsletterCampaign\[\]\s+@relation\("CampaignAuthor"\)/.test(authorBlock),
  );
  check(
    "abonné : relation nommée CampaignAuthor côté campagne",
    /@relation\("CampaignAuthor", fields: \[createdById\]/.test(schema),
  );
  check(
    "unicité : email, jeton de confirmation, compte lié",
    /email\s+String\s+@unique/.test(schema) &&
      /confirmationToken\s+String\?\s+@unique/.test(schema) &&
      /userId\s+String\?\s+@unique/.test(schema),
  );
  check("unicité : un envoi par campagne et par abonné", /@@unique\(\[campaignId, subscriberId\]\)/.test(schema));

  const migration = existsSync(path.join(ROOT, MIGRATION)) ? readSource(MIGRATION) : "";
  check("migration init_postgres présente", migration.length > 0, MIGRATION);
  check(
    "migration : quatre tables, table de jointure et clés étrangères",
    MODELS.every((model) => migration.includes(`CREATE TABLE "${model}"`)) &&
      migration.includes('CREATE TABLE "_NewsletterListToNewsletterSubscriber"') &&
      migration.includes('FOREIGN KEY ("userId") REFERENCES "Author"("id") ON DELETE SET NULL') &&
      migration.includes('FOREIGN KEY ("listId") REFERENCES "NewsletterList"("id") ON DELETE CASCADE'),
  );
  const applied = db
    .prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%init_postgres%' AND finished_at IS NOT NULL",
    )
    .get();
  check("migration init_postgres enregistrée en base", Boolean(applied), applied?.migration_name);

  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  check(
    "base : colonnes de NewsletterSubscriber",
    ["id", "email", "name", "status", "confirmationToken", "confirmedAt", "unsubscribedAt", "userId", "source", "createdAt", "updatedAt"].every(
      (column) => columns("NewsletterSubscriber").includes(column),
    ),
    columns("NewsletterSubscriber").join(", "),
  );
  check(
    "base : colonnes de NewsletterCampaign",
    ["listId", "subject", "previewText", "contentHtml", "contentText", "status", "scheduledAt", "sentAt", "recipientCount", "deliveredCount", "openCount", "clickCount", "bounceCount", "createdById"].every(
      (column) => columns("NewsletterCampaign").includes(column),
    ),
  );
  check(
    "base : colonnes de NewsletterSend",
    ["campaignId", "subscriberId", "status", "sentAt", "deliveredAt", "openedAt", "clickedAt", "errorMessage", "providerMessageId"].every(
      (column) => columns("NewsletterSend").includes(column),
    ),
  );
  check(
    "base : colonnes de NewsletterList",
    ["id", "name", "slug", "description", "active", "createdAt", "updatedAt"].every((column) =>
      columns("NewsletterList").includes(column),
    ),
  );
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'Newsletter%'")
    .all()
    .map((row) => row.name);
  check(
    "base : index d'unicité et de lecture créés",
    ["NewsletterSubscriber_email_key", "NewsletterSubscriber_status_idx", "NewsletterSubscriber_createdAt_idx", "NewsletterSend_campaignId_subscriberId_key"].every(
      (name) => indexes.includes(name),
    ),
    `${indexes.length} index`,
  );

  /* ------------------------------------------------------- 2) Helpers et code */
  console.log("\n--- Helpers et composants ---");
  check(
    "lib/newsletter : trois listes de statuts et leurs libellés",
    newsletter.includes("SUBSCRIBER_STATUSES") &&
      newsletter.includes("CAMPAIGN_STATUSES") &&
      newsletter.includes("SEND_STATUSES") &&
      SUBSCRIBER_STATUSES.every((status) => newsletter.includes(`${status}:`)) &&
      CAMPAIGN_STATUSES.every((status) => newsletter.includes(`${status}:`)),
  );
  check(
    "lib/newsletter : teintes du design system pour chaque statut",
    newsletter.includes("SUBSCRIBER_STATUS_TONES") &&
      newsletter.includes("CAMPAIGN_STATUS_TONES") &&
      newsletter.includes('import type { BadgeTone }'),
  );
  check(
    "lib/newsletter : pourcentage français et taux d'ouverture",
    newsletter.includes("export function percent") &&
      newsletter.includes('replace(".", ",")') &&
      newsletter.includes("export function openRate") &&
      newsletter.includes("export function unsubscribeRate"),
  );
  check(
    "lib/newsletter : dénominateur nul affiché « — », jamais NaN",
    /if \(!Number\.isFinite\(part\) \|\| !Number\.isFinite\(whole\) \|\| whole <= 0\) return "—"/.test(
      newsletter,
    ),
  );
  check(
    "lib/newsletter : origines connues et libellé de repli",
    newsletter.includes("SUBSCRIBER_SOURCE_LABELS") &&
      newsletter.includes("export function subscriberSourceLabel") &&
      newsletter.includes("footer: \"Pied de page\""),
  );
  check(
    "aucun composant client ajouté (administration sans JavaScript)",
    ![subscribersTab, campaignsTab, subscriberDetail, campaignDetail, page].some((source) =>
      source.includes('"use client"'),
    ),
  );
  check(
    "style : design system utilisé (Badge, Card) et icônes lucide",
    subscribersTab.includes('from "@/components/ui/Badge"') &&
      campaignsTab.includes('from "@/components/ui/Badge"') &&
      subscriberDetail.includes('from "@/components/ui/Card"') &&
      campaignDetail.includes('from "@/components/ui/Card"') &&
      page.includes('from "lucide-react"'),
  );
  check(
    "page : onglets Abonnés et Campagnes",
    /label: "Abonnés"/.test(page) && /label: "Campagnes"/.test(page),
  );
  check(
    "page : accès réservé aux ADMIN (page et actions)",
    page.includes('redirect("/login")') &&
      page.includes('redirect("/studio")') &&
      actions.includes('redirect("/login")') &&
      actions.includes('redirect("/studio")'),
  );

  /* ------------------------------------------------------------- 3) Jeu de test */
  console.log("\n--- Jeu de test et unicité ---");
  const journalist = db.prepare("SELECT id, email FROM Author WHERE email = ?").get("journalist@example.com");
  const admin = db.prepare("SELECT id FROM Author WHERE email = ?").get("admin@example.com");
  check("comptes de référence présents", Boolean(journalist && admin));

  insertList(ids.listPrimary, `Hebdo ${TAG}`);
  insertList(ids.listSecondary, `Mercato ${TAG}`, 0);

  const now = new Date();
  const stamp = (offsetSeconds) => new Date(now.getTime() + offsetSeconds * 1000).toISOString();

  insertSubscriber.run(
    ids.subscriberConfirmed,
    `${ids.subscriberConfirmed}@example.test`,
    "Claire Confirmée",
    "CONFIRMED",
    null,
    stamp(-100),
    null,
    journalist.id,
    "footer",
    stamp(100),
    stamp(100),
  );
  insertSubscriber.run(
    ids.subscriberPending,
    `${ids.subscriberPending}@example.test`,
    null,
    "PENDING",
    `${TAG}-jeton`,
    null,
    null,
    null,
    "popup",
    stamp(101),
    stamp(101),
  );
  insertSubscriber.run(
    ids.subscriberUnsubscribed,
    `${ids.subscriberUnsubscribed}@example.test`,
    "Parti Volontaire",
    "UNSUBSCRIBED",
    null,
    stamp(-200),
    stamp(-150),
    null,
    "article",
    stamp(102),
    stamp(102),
  );
  insertSubscriber.run(
    ids.subscriberBounced,
    `${ids.subscriberBounced}@example.test`,
    null,
    "BOUNCED",
    null,
    null,
    null,
    null,
    "import",
    stamp(103),
    stamp(103),
  );
  // 28 abonnés supplémentaires : la pagination (25 par page) devient observable.
  ids.bulk.forEach((id, index) => {
    insertSubscriber.run(
      id,
      bulkEmail(id),
      null,
      index % 7 === 0 ? "PENDING" : "CONFIRMED",
      null,
      null,
      null,
      null,
      "import",
      stamp(10 + index),
      stamp(10 + index),
    );
  });
  db.prepare(
    `INSERT INTO _NewsletterListToNewsletterSubscriber (A, B) VALUES (?, ?), (?, ?), (?, ?)`,
  ).run(ids.listPrimary, ids.subscriberConfirmed, ids.listPrimary, ids.subscriberPending, ids.listSecondary, ids.subscriberConfirmed);

  insertCampaign({
    id: ids.campaignSent,
    listId: ids.listPrimary,
    subject: `Hebdo du dimanche ${TAG}`,
    status: "SENT",
    createdById: admin.id,
    sentAt: stamp(-60),
    contentHtml: `<b>${TAG}</b> et <script>alert(1)</script>`,
    previewText: "Les titres de la semaine",
    recipientCount: 10,
    deliveredCount: 9,
    openCount: 3,
    clickCount: 1,
    bounceCount: 1,
    createdAt: stamp(5),
  });
  insertCampaign({
    id: ids.campaignDraft,
    listId: ids.listSecondary,
    subject: `Brouillon ${TAG}`,
    status: "DRAFT",
    createdById: admin.id,
    createdAt: stamp(6),
  });
  insertSend(`${TAG}-send-1`, ids.campaignSent, ids.subscriberConfirmed, "OPENED", { sentAt: stamp(-60) });
  insertSend(`${TAG}-send-2`, ids.campaignSent, ids.subscriberPending, "BOUNCED", {
    sentAt: stamp(-60),
    errorMessage: "Adresse rejetée",
  });
  check(
    "jeu de test inséré",
    db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?").get(`${TAG}%`).c === 32 &&
      db.prepare("SELECT COUNT(*) AS c FROM NewsletterCampaign WHERE id LIKE ?").get(`${TAG}%`).c === 2,
  );

  let duplicateEmail = null;
  try {
    insertSubscriber.run(
      `${TAG}-doublon-email`,
      `${ids.subscriberConfirmed}@example.test`,
      null,
      "PENDING",
      null,
      null,
      null,
      null,
      null,
      stamp(30),
      stamp(30),
    );
  } catch (error) {
    duplicateEmail = error.message;
  }
  check("unicité : deux abonnés ne peuvent pas partager un email", Boolean(duplicateEmail), duplicateEmail?.slice(0, 60));

  let duplicateUser = null;
  try {
    insertSubscriber.run(
      `${TAG}-doublon-compte`,
      `${TAG}-autre@example.test`,
      null,
      "PENDING",
      null,
      null,
      null,
      journalist.id,
      null,
      stamp(31),
      stamp(31),
    );
  } catch (error) {
    duplicateUser = error.message;
  }
  check("unicité : un compte ne peut être lié qu'à un abonné", Boolean(duplicateUser), duplicateUser?.slice(0, 60));

  let duplicateSend = null;
  try {
    insertSend(`${TAG}-send-doublon`, ids.campaignSent, ids.subscriberConfirmed, "SENT");
  } catch (error) {
    duplicateSend = error.message;
  }
  check(
    "unicité : un abonné ne reçoit qu'une fois une campagne",
    Boolean(duplicateSend),
    duplicateSend?.slice(0, 60),
  );

  let duplicateSlug = null;
  try {
    insertList(`${TAG}-list-doublon`, `Autre ${TAG}`, 1);
    db.prepare("UPDATE NewsletterList SET slug = ? WHERE id = ?").run(ids.listPrimary, `${TAG}-list-doublon`);
  } catch (error) {
    duplicateSlug = error.message;
  }
  check("unicité : deux listes ne peuvent pas partager un slug", Boolean(duplicateSlug));
  db.prepare("DELETE FROM NewsletterList WHERE id = ?").run(`${TAG}-list-doublon`);

  /* --------------------------------------------------------- 4) Accès et page */
  console.log("\n--- Page /backoffice/newsletter ---");
  const anonymous = await get(BASE_PATH);
  check(
    "visiteur : redirection vers /login",
    [302, 307].includes(anonymous.status) && String(anonymous.location ?? "").includes("/login"),
    `${anonymous.status} ${anonymous.location ?? "—"}`,
  );

  const journalistJar = await login("journalist@example.com", "password123");
  const editorJar = await login("editor@example.com", "password123");
  const adminJar = await login("admin@example.com", "admin123");
  check(
    "sessions de test ouvertes",
    [journalistJar, editorJar, adminJar].every((jar) => jar.has("authjs.session-token")),
  );

  const asJournalist = await get(BASE_PATH, { jar: journalistJar });
  const asEditor = await get(BASE_PATH, { jar: editorJar });
  check(
    "JOURNALIST et EDITOR : redirection vers /studio",
    asJournalist.status === 307 &&
      asJournalist.location === "/studio" &&
      asEditor.status === 307 &&
      asEditor.location === "/studio",
    `${asJournalist.status}/${asEditor.status}`,
  );

  const asAdmin = await get(BASE_PATH, { jar: adminJar });
  check("ADMIN : page accessible", asAdmin.status === 200, `status=${asAdmin.status}`);
  check(
    "deux onglets affichés",
    asAdmin.body.includes(">Abonnés<") && asAdmin.body.includes(">Campagnes<"),
  );
  check(
    "lien Newsletter dans la barre latérale du backoffice",
    asAdmin.body.includes('href="/backoffice/newsletter"') &&
      backofficeNav.includes('href="/backoffice/newsletter"'),
  );
  check(
    "raccourci Newsletter sur le tableau de bord",
    backofficePage.includes("/backoffice/newsletter") && backofficePage.includes("confirmedSubscribers"),
  );

  /* ------------------------------------------------------- 5) Statistiques */
  console.log("\n--- Statistiques ---");
  const totalSubscribers = db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber").get().c;
  const confirmedSubscribers = db
    .prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE status = 'CONFIRMED'")
    .get().c;
  const unsubscribed = db
    .prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE status = 'UNSUBSCRIBED'")
    .get().c;
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const sentThisMonth = db
    .prepare("SELECT COUNT(*) AS c FROM NewsletterCampaign WHERE status = 'SENT' AND sentAt >= ?")
    .get(startOfMonth).c;
  const expectedRate = `${((unsubscribed / totalSubscribers) * 100).toFixed(1).replace(".", ",")} %`;

  check(
    "statistique : abonnés confirmés",
    text(asAdmin.body).includes("Abonnés confirmés") &&
      new RegExp(`>${confirmedSubscribers}<`).test(text(asAdmin.body)),
    `attendu ${confirmedSubscribers}`,
  );
  check(
    "statistique : taux de désabonnement calculé",
    text(asAdmin.body).includes(expectedRate),
    `attendu ${expectedRate}`,
  );
  check(
    "statistique : campagnes envoyées ce mois",
    text(asAdmin.body).includes("Campagnes envoyées ce mois") &&
      new RegExp(`>${sentThisMonth}<`).test(text(asAdmin.body)),
    `attendu ${sentThisMonth}`,
  );

  /* --------------------------------------------------- 6) Onglet « Abonnés » */
  console.log("\n--- Onglet Abonnés ---");
  const subscribersView = await get(BASE_PATH, { jar: adminJar });
  check(
    "colonnes du tableau",
    ["Email", "Nom", "Statut", "Origine", "Inscription", "Listes", "Actions"].every((label) =>
      subscribersView.body.includes(`>${label}<`),
    ),
  );
  check(
    "abonné créé manuellement visible avec son statut",
    subscribersView.body.includes(`${ids.subscriberConfirmed}@example.test`) &&
      subscribersView.body.includes("Confirmé") &&
      subscribersView.body.includes("En attente") &&
      subscribersView.body.includes("Désabonné"),
  );
  check(
    "origine lisible (« Pied de page », « Fenêtre modale »)",
    subscribersView.body.includes("Pied de page") && subscribersView.body.includes("Fenêtre modale"),
  );
  check(
    "listes affichées en badges",
    subscribersView.body.includes(`Hebdo ${TAG}`) && subscribersView.body.includes(`Mercato ${TAG}`),
  );
  check(
    "pagination : 25 abonnés sur la première page",
    text(subscribersView.body).includes(
      `${totalSubscribers} abonné${totalSubscribers > 1 ? "s" : ""} · page 1 / 2`,
    ) && text(subscribersView.body).includes("Page suivante"),
    `${totalSubscribers} abonnés en base`,
  );
  const secondPage = await get(`${BASE_PATH}?tab=subscribers&page=2`, { jar: adminJar });
  check(
    "seconde page d'abonnés",
    text(secondPage.body).includes("page 2 / 2") && secondPage.body.includes(bulkEmail(ids.bulk[0])),
  );

  check(
    "bouton Désabonner présent pour un abonné actif, absent pour un désabonné",
    subscribersView.body.includes(">Désabonner<") &&
      boundFormFields(subscribersView.body, ids.subscriberUnsubscribed) === null,
  );
  /* ------------------------------------------------ 7) Actions d'administration */
  console.log("\n--- Actions ---");
  const unsubscribe = await submitBoundForm(adminJar, BASE_PATH, ids.subscriberPending);
  const afterUnsubscribe = subscriberRow(ids.subscriberPending);
  check(
    "Désabonner : statut UNSUBSCRIBED et date renseignée",
    unsubscribe.ok &&
      afterUnsubscribe?.status === "UNSUBSCRIBED" &&
      Boolean(afterUnsubscribe?.unsubscribedAt),
    `${afterUnsubscribe?.status ?? "—"} / ${afterUnsubscribe?.unsubscribedAt ?? "—"}`,
  );

  const firstDate = afterUnsubscribe?.unsubscribedAt;
  const beforeRepeat = db
    .prepare("SELECT unsubscribedAt FROM NewsletterSubscriber WHERE id = ?")
    .get(ids.subscriberUnsubscribed)?.unsubscribedAt;
  await callAction(adminJar, BASE_PATH, findActionId("unsubscribeSubscriber"), [ids.subscriberUnsubscribed]);
  check(
    "désabonnement idempotent : la première date est conservée",
    Boolean(firstDate) &&
      Boolean(beforeRepeat) &&
      db
        .prepare("SELECT unsubscribedAt FROM NewsletterSubscriber WHERE id = ?")
        .get(ids.subscriberUnsubscribed)?.unsubscribedAt === beforeRepeat,
    `date conservée ${beforeRepeat ?? "—"}`,
  );

  const duplicate = await submitBoundForm(adminJar, `${BASE_PATH}?tab=campaigns`, ids.campaignSent);
  const copy = db
    .prepare("SELECT id, subject, status, recipientCount, openCount, createdById FROM NewsletterCampaign WHERE subject = ?")
    .get(`Copie de Hebdo du dimanche ${TAG}`);
  check(
    "Dupliquer : copie en brouillon, compteurs remis à zéro",
    duplicate.ok &&
      copy?.status === "DRAFT" &&
      copy?.recipientCount === 0 &&
      copy?.openCount === 0 &&
      copy?.createdById === admin.id,
    `${copy?.status ?? "aucune copie"} / ${copy?.recipientCount ?? "—"}`,
  );
  const copyHtml = db
    .prepare("SELECT contentHtml, previewText FROM NewsletterCampaign WHERE subject = ?")
    .get(`Copie de Hebdo du dimanche ${TAG}`);
  check(
    "Dupliquer : contenu et pré-en-tête repris, aucun envoi copié",
    copyHtml?.contentHtml?.includes(TAG) &&
      copyHtml?.previewText === "Les titres de la semaine" &&
      db.prepare("SELECT COUNT(*) AS c FROM NewsletterSend WHERE campaignId = ?").get(copy.id).c === 0,
  );

  const actionIdUnsubscribe = findActionId("unsubscribeSubscriber");
  const actionIdDuplicate = findActionId("duplicateCampaign");
  check(
    "actions serveur exportées et enregistrées",
    Boolean(actionIdUnsubscribe && actionIdDuplicate),
    `${actionIdUnsubscribe?.slice(0, 8) ?? "?"} / ${actionIdDuplicate?.slice(0, 8) ?? "?"}`,
  );

  const beforeForged = subscriberRow(ids.subscriberBounced);
  const forgedJournalist = await callAction(journalistJar, BASE_PATH, actionIdUnsubscribe, [ids.subscriberBounced]);
  check(
    "un JOURNALIST ne peut pas désabonner par appel direct",
    (String(forgedJournalist.location ?? "").includes("/studio") ||
      forgedJournalist.body.includes("/studio")) &&
      subscriberRow(ids.subscriberBounced)?.status === beforeForged?.status,
    `${forgedJournalist.status} ${forgedJournalist.location ?? "—"} / statut inchangé=${subscriberRow(ids.subscriberBounced)?.status === beforeForged?.status}`,
  );
  const forgedAnonymous = await callAction(null, BASE_PATH, actionIdUnsubscribe, [ids.subscriberBounced]);
  check(
    "un visiteur ne peut pas désabonner par appel direct",
    ([302, 307].includes(forgedAnonymous.status) ||
      String(forgedAnonymous.location ?? "").includes("/login") ||
      forgedAnonymous.body.includes("/login")) &&
      subscriberRow(ids.subscriberBounced)?.status === beforeForged?.status,
    `${forgedAnonymous.status} ${forgedAnonymous.location ?? "—"}`,
  );
  const missing = await callAction(adminJar, BASE_PATH, actionIdDuplicate, [`${TAG}-inexistante`]);
  check(
    "dupliquer une campagne inexistante ne casse rien",
    missing.status < 400,
    `status=${missing.status}`,
  );

  /* ------------------------------------------------- 8) Onglet « Campagnes » */
  console.log("\n--- Onglet Campagnes ---");
  const campaignsView = await get(`${BASE_PATH}?tab=campaigns`, { jar: adminJar });
  check(
    "colonnes du tableau des campagnes",
    ["Sujet", "Liste", "Statut", "Envoi", "Destinataires", "Actions"].every((label) =>
      campaignsView.body.includes(`>${label}<`),
    ) && /Taux d(?:&#x27;|')ouverture/.test(campaignsView.body),
  );
  check(
    "campagne envoyée visible avec son taux d'ouverture",
    campaignsView.body.includes(`Hebdo du dimanche ${TAG}`) &&
      text(campaignsView.body).includes("33,3 %") &&
      text(campaignsView.body).includes("9 délivrés · 2 envois"),
    "3 ouvertures sur 9 délivrés",
  );
  check(
    "brouillon listé avec un taux indéterminé",
    campaignsView.body.includes(`Brouillon ${TAG}`) && campaignsView.body.includes(">Brouillon<"),
  );
  check(
    "actions Voir et Dupliquer disponibles",
    campaignsView.body.includes(">Dupliquer<") &&
      boundFormFields(campaignsView.body, ids.campaignSent) !== null,
  );

  /* ------------------------------------------------------ 9) Panneaux de détail */
  console.log("\n--- Panneaux de détail ---");
  const subscriberPanel = await get(`${BASE_PATH}?tab=subscribers&abonne=${ids.subscriberConfirmed}`, {
    jar: adminJar,
  });
  check(
    "détail abonné : coordonnées, compte lié, listes et envois",
    subscriberPanel.status === 200 &&
      subscriberPanel.body.includes("Claire Confirmée") &&
      subscriberPanel.body.includes(`${journalist.email}`) &&
      subscriberPanel.body.includes(`Hebdo ${TAG}`) &&
      subscriberPanel.body.includes("Hebdo du dimanche") &&
      subscriberPanel.body.includes(">Fermer<"),
  );
  check(
    "détail abonné : pas de message « aucune liste » quand il en a",
    !subscriberPanel.body.includes("Cet abonné n'est inscrit à aucune liste."),
  );
  const withoutLists = await get(`${BASE_PATH}?tab=subscribers&abonne=${ids.subscriberBounced}`, {
    jar: adminJar,
  });
  check(
    "détail d'un abonné sans liste",
    withoutLists.body.includes("Cet abonné n'est inscrit à aucune liste."),
  );

  const campaignPanel = await get(`${BASE_PATH}?tab=campaigns&campagne=${ids.campaignSent}`, {
    jar: adminJar,
  });
  check(
    "détail campagne : compteurs et envois individuels",
    campaignPanel.status === 200 &&
      campaignPanel.body.includes(`Hebdo du dimanche ${TAG}`) &&
      text(campaignPanel.body).includes("taux 33,3 %") &&
      campaignPanel.body.includes("Adresse rejetée") &&
      campaignPanel.body.includes(`${ids.subscriberConfirmed}@example.test`),
  );
  check(
    "détail campagne : source HTML échappée, jamais injectée",
    campaignPanel.body.includes("&lt;script&gt;alert(1)&lt;/script&gt;") &&
      !campaignPanel.body.includes("<script>alert(1)</script>"),
  );
  const draftPanel = await get(`${BASE_PATH}?tab=campaigns&campagne=${ids.campaignDraft}`, {
    jar: adminJar,
  });
  check(
    "détail d'un brouillon : taux indéterminé et aucun envoi",
    text(draftPanel.body).includes("taux —") &&
      draftPanel.body.includes("Aucun envoi individuel"),
  );
  const wrongTab = await get(`${BASE_PATH}?tab=campaigns&abonne=${ids.subscriberConfirmed}`, {
    jar: adminJar,
  });
  check(
    "un abonné n'est pas détaillé depuis l'onglet Campagnes",
    !wrongTab.body.includes("Jeton de confirmation"),
  );

  /* ----------------------------------------------------------- 10) Périmètre */
  console.log("\n--- Périmètre ---");
  const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) };
  check(
    "aucune bibliothèque d'UI ajoutée (l'e-mail relève du WP11b)",
    !["@react-email/components", "@radix-ui/react-dialog", "shadcn-ui", "mjml", "handlebars"].some(
      (name) => name in dependencies,
    ) &&
      Boolean(dependencies.resend),
    `resend ${dependencies.resend ?? "absent"} (SDK d'envoi, WP11b)`,
  );
  check(
    "l'envoi passe par un point d'entrée unique, hors des composants du WP11a",
    // Le WP11b ajoute l'action d'envoi, qui délègue à `@/lib/newsletter-send` ;
    // les composants de consultation du WP11a, eux, ne connaissent aucun
    // fournisseur d'e-mail.
    /from "@\/lib\/newsletter-send"/.test(actions) &&
      !/(nodemailer|sendgrid|postmark|mailgun|transport\.sendMail)/i.test(
        subscribersTab + campaignsTab + subscriberDetail + campaignDetail + newsletter,
      ),
  );
  check(
    "périmètre : aucun formulaire d'inscription ni de campagne",
    // Le WP11b ouvre des pages publiques (`/newsletter/confirm`, `/unsubscribe`)
    // mais aucun formulaire : l'inscription publique est le WP11c, la rédaction
    // de campagne le WP11d.
    !/name="subject"/.test(page + campaignsTab) &&
      !/<form[^>]*>\s*<(input|textarea)/i.test(page) &&
      !/<input[^>]+type="email"/i.test(page + subscribersTab),
  );
  check(
    "périmètre : modules interdits inchangés (aucune mention de la newsletter)",
    ["src/lib/prisma.ts", "src/lib/auth.ts", "src/lib/stripe.ts", "src/lib/seo.ts", "src/lib/analytics.ts", "src/lib/engagement.ts", "src/lib/notifications.ts", "src/middleware.ts"].every(
      (file) => !/newsletter/i.test(readSource(file)),
    ),
  );
  check(
    "périmètre : studio, pages sportives et espace abonné intacts",
    ["src/app/studio/articles/page.tsx", "src/app/scores/page.tsx", "src/app/mon-compte/page.tsx"].every(
      (file) => !/newsletter/i.test(readSource(file)),
    ),
  );
  check(
    "périmètre : modèles existants inchangés (aucune relation newsletter parasite)",
    [
      "model Article {",
      "model Category {",
      "model Comment {",
      "model CommentReaction {",
      "model ArticleReaction {",
      "model Report {",
      "model Notification {",
      "model Plan {",
      "model Subscription {",
      "model Payment {",
      "model SubscriptionEvent {",
      "model AnalyticsVisitor {",
      "model AnalyticsPageView {",
      "model AnalyticsDaily {",
      "model Competition {",
      "model Team {",
      "model Match {",
    ].every((needle) => {
      const start = schema.indexOf(needle);
      if (start === -1) return false;
      const end = schema.indexOf("\n}", start);
      return end > start && !/newsletter/i.test(schema.slice(start, end));
    }),
  );

  /* ------------------------------------------------- 11) Intégrité référentielle */
  console.log("\n--- Intégrité référentielle ---");
  const cascadeAuthor = `${TAG}-auteur-cascade`;
  const cascadeSubscriber = `${TAG}-sub-cascade`;
  createUser(cascadeAuthor, `Auteur ${TAG}`, "JOURNALIST");
  insertSubscriber.run(
    cascadeSubscriber,
    `${cascadeSubscriber}@example.test`,
    null,
    "CONFIRMED",
    null,
    null,
    null,
    cascadeAuthor,
    "compte",
    stamp(120),
    stamp(120),
  );
  db.prepare("DELETE FROM Author WHERE id = ?").run(cascadeAuthor);
  check(
    "supprimer un compte ne supprime pas l'abonnement (lien remis à NULL)",
    db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id = ?").get(cascadeSubscriber).c === 1 &&
      subscriberRow(cascadeSubscriber)?.userId === null,
  );

  insertSend(`${TAG}-send-cascade`, ids.campaignSent, cascadeSubscriber, "SENT");
  const sendsBefore = db
    .prepare("SELECT COUNT(*) AS c FROM NewsletterSend WHERE campaignId = ?")
    .get(ids.campaignSent).c;
  db.prepare("DELETE FROM NewsletterCampaign WHERE id = ?").run(ids.campaignSent);
  check(
    "supprimer une campagne emporte ses envois",
    sendsBefore >= 3 &&
      db.prepare("SELECT COUNT(*) AS c FROM NewsletterSend WHERE campaignId = ?").get(ids.campaignSent).c === 0,
    `${sendsBefore} envoi(s) supprimé(s)`,
  );

  const listSubscribersBefore = db
    .prepare("SELECT COUNT(*) AS c FROM _NewsletterListToNewsletterSubscriber WHERE A = ?")
    .get(ids.listSecondary).c;
  db.prepare("DELETE FROM NewsletterList WHERE id = ?").run(ids.listSecondary);
  check(
    "supprimer une liste retire les appartenances, pas les abonnés",
    listSubscribersBefore > 0 &&
      db
        .prepare("SELECT COUNT(*) AS c FROM _NewsletterListToNewsletterSubscriber WHERE A = ?")
        .get(ids.listSecondary).c === 0 &&
      Boolean(subscriberRow(ids.subscriberConfirmed)),
  );

  /* ------------------------------------------------- 11) Gestion des listes */
  // Correctif WP11f : les listes n'étaient créables que dans Prisma Studio, ce
  // qui rendait impossible l'ouverture d'une nouvelle liste thématique.
  console.log("\n--- Gestion des listes (onglet Listes) ---");
  const listsTab = await get(`${BASE_PATH}?tab=lists`, { jar: adminJar });
  check(
    "onglet Listes accessible avec son formulaire de création",
    listsTab.status === 200 &&
      listsTab.body.includes('name="name"') &&
      listsTab.body.includes('name="description"') &&
      listsTab.body.includes('name="active"') &&
      text(listsTab.body).includes("Créer la liste"),
  );
  check(
    "les listes existantes sont listées avec leurs compteurs",
    listsTab.body.includes(`Hebdo ${TAG}`) && text(listsTab.body).includes("Active"),
  );

  const newListName = `Liste créée ${TAG}`;
  const createList = await submitFields(adminJar, `${BASE_PATH}?tab=lists`, 'id="list-name-create"', {
    name: newListName,
    description: "Créée depuis l'administration",
    active: "on",
  });
  const createdList = db.prepare("SELECT id, slug, active FROM NewsletterList WHERE name = ?").get(newListName);
  check(
    "création d'une liste depuis l'administration",
    createList.ok && createdList?.active === 1 && Boolean(createdList?.slug),
    `${createdList?.slug ?? "aucune"} / actif=${createdList?.active ?? "—"}`,
  );
  check(
    "la liste créée apparaît dans le formulaire public d'inscription",
    (await get("/newsletter")).body.includes(newListName),
  );

  // Renommage puis désactivation : le formulaire d'édition est repéré par
  // l'identifiant de son champ (les deux formulaires coexistent sur la page).
  const renameList = await submitFields(
    adminJar,
    `${BASE_PATH}?tab=lists&liste=${createdList.id}`,
    'id="list-name-edit"',
    { name: `${newListName} (renommée)`, description: "Description modifiée" },
  );
  const renamed = db.prepare("SELECT name, active FROM NewsletterList WHERE id = ?").get(createdList.id);
  check(
    "édition d'une liste : nom mis à jour, activation retirée (case non cochée)",
    renameList.ok && renamed?.name === `${newListName} (renommée)` && renamed?.active === 0,
    `${renamed?.name ?? "—"} / actif=${renamed?.active ?? "—"}`,
  );
  check(
    "une liste désactivée disparaît du formulaire public",
    !(await get("/newsletter")).body.includes(`${newListName} (renommée)`),
  );

  const toggle = await callAction(adminJar, `${BASE_PATH}?tab=lists`, findActionId("toggleList"), [
    createdList.id,
  ]);
  check(
    "bascule d'activation : la liste redevient active",
    toggle.status < 400 &&
      db.prepare("SELECT active FROM NewsletterList WHERE id = ?").get(createdList.id).active === 1,
  );

  const deleteUsed = await callAction(adminJar, `${BASE_PATH}?tab=lists`, findActionId("deleteList"), [
    ids.listPrimary,
  ]);
  const refusedNotice = await get(`${BASE_PATH}?tab=lists&liste=${ids.listPrimary}&message=liste-utilisee`, {
    jar: adminJar,
  });
  check(
    "suppression refusée pour une liste rattachée à une campagne",
    deleteUsed.status < 400 &&
      Boolean(db.prepare("SELECT id FROM NewsletterList WHERE id = ?").get(ids.listPrimary)) &&
      refusedNotice.body.includes("effacerait ces campagnes"),
  );

  const deleteFree = await callAction(adminJar, `${BASE_PATH}?tab=lists`, findActionId("deleteList"), [
    createdList.id,
  ]);
  check(
    "suppression d'une liste sans campagne : effective",
    deleteFree.status < 400 &&
      !db.prepare("SELECT id FROM NewsletterList WHERE id = ?").get(createdList.id),
  );

  /* ------------------------------------------------- 12) Non-régression locale */
  console.log("\n--- Non-régression ---");
  check("accueil toujours servi", (await get("/")).status === 200);
  check("modération accessible", (await get("/backoffice/comments", { jar: adminJar })).status === 200);
  check(
    "notifications in-app toujours accessibles",
    (await get("/mon-compte/notifications", { jar: adminJar })).status === 200,
  );
  check("page des scores toujours servie", (await get("/scores")).status === 200);

  cleanup();
  const leftovers = db.prepare("SELECT COUNT(*) AS c FROM NewsletterSubscriber WHERE id LIKE ?").get(`${TAG}%`).c;
  check("nettoyage : aucune donnée de test laissée en base", leftovers === 0, `${leftovers} restant(s)`);

  db.close();

  const failed = results.filter((result) => !result).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  try {
    cleanup();
  } catch {
    /* nettoyage au mieux */
  }
  console.error("ERREUR:", error.stack);
  process.exit(1);
});
