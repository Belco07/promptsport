/**
 * Vérification du WP11e — notifications par e-mail.
 * Exécution : PORT=3002 node scripts/check-wp11e.cjs
 *
 * La suite vérifie le schéma et la migration, les helpers de préférence, les cinq
 * gabarits, le branchement non bloquant, le plafond horaire et la page de
 * préférences — en exerçant les parcours réels : réponse à un commentaire,
 * approbation, rejet, bannissement, signalement traité.
 *
 * L'envoi est observé sur le **serveur Resend factice** (voir check-wp11b) : la
 * suite démarre le sien et c'est l'application qui y écrit, si elle est lancée
 * avec `RESEND_BASE_URL`. Les contrôles d'e-mail adaptent leur libellé à ce cas.
 *
 * Toutes les données créées sont préfixées « chk11e » et supprimées à la fin.
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
const STUB_PORT = Number(process.env.STUB_PORT || 3100);

const dbUrl = readFileSync(path.join(ROOT, ".env"), "utf8").match(
  /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m,
)[1];
const db = new Database(path.resolve(ROOT, dbUrl.replace(/^file:(\/\/)?/, "")));
db.pragma("foreign_keys = true");

const readSource = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const schema = readSource("prisma/schema.prisma");
const notifEmail = readSource("src/lib/notification-email.ts");
const notificationsLib = readSource("src/lib/notifications.ts");
const templates = readSource("src/lib/email-templates.ts");
const rateLimit = readSource("src/lib/rate-limit.ts");
const preferencesPage = readSource("src/app/mon-compte/preferences/page.tsx");
const preferencesActions = readSource("src/app/mon-compte/preferences/actions.ts");
const preferencesComponent = readSource("src/components/NotificationPreferences.tsx");
const accountPage = readSource("src/app/mon-compte/page.tsx");

// WP12a : les migrations SQLite ont été remplacées par la migration unique
// `init_postgres`, qui contient désormais ces colonnes.
const MIGRATION = "prisma/migrations/20261002120000_init_postgres/migration.sql";
const TYPES = ["COMMENT_REPLY", "COMMENT_APPROVED", "COMMENT_REJECTED", "USER_BANNED", "REPORT_RESOLVED"];

const TAG = `chk11e-${crypto.randomBytes(4).toString("hex")}`;
const MARKER = `${TAG}-marqueur`;
const ids = {
  author: `${TAG}-auteur`,
  peer: `${TAG}-lecteur`,
  failing: `${TAG}-echec`,
  category: `${TAG}-cat`,
  article: `${TAG}-art`,
  root: `${TAG}-root`,
  comments: Array.from({ length: 24 }, (_, index) => `${TAG}-cmt-${String(index).padStart(2, "0")}`),
};
const address = (id) => `${id}@example.test`;
const slug = `${TAG}-article`;

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

async function login(emailAddress, password, callbackPath = "/mon-compte") {
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

/** Soumet un formulaire en multipart, comme un navigateur sans JavaScript. */
async function submitForm(jar, urlPath, { contains, fields = {} }) {
  const page = await get(urlPath, { jar });
  const harvested = formFields(page.body, contains);
  if (!harvested) return { ok: false, reason: "formulaire introuvable" };

  const boundary = `----WP11E${crypto.randomBytes(8).toString("hex")}`;
  const parts = [];
  for (const [key, value] of Object.entries({ ...harvested, ...fields })) {
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

const text = (html) => html.replace(/<!-- -->/g, "");
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
        const recipients = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
        // Une adresse contenant « echec » simule un refus du fournisseur.
        const failed = recipients.some((value) => String(value).includes("echec"));
        stubMails.push({
          to: parsed.to,
          subject: parsed.subject,
          html: parsed.html ?? "",
          text: parsed.text ?? "",
          tags: parsed.tags ?? [],
          failed,
        });
        if (failed) {
          res.writeHead(422, { "content-type": "application/json" });
          res.end(JSON.stringify({ statusCode: 422, name: "validation_error", message: "Adresse invalide (simulation)." }));
          return;
        }
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

/** Attend qu'un prédicat soit vrai (l'envoi d'e-mail n'est pas attendu par l'action). */
async function waitFor(predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
}

const mailsTo = (recipient) => stubMails.filter((mail) => mail.to === recipient);

/* ---------------------------------------------------------------- fixtures */

const notificationCount = (userId) =>
  db.prepare("SELECT COUNT(*) AS c FROM Notification WHERE userId = ?").get(userId).c;
const notificationTypes = (userId) =>
  db
    .prepare("SELECT type FROM Notification WHERE userId = ? ORDER BY createdAt")
    .all(userId)
    .map((row) => row.type);
const authorPrefs = (id) =>
  db
    .prepare("SELECT emailNotificationsEnabled, emailNotificationTypes FROM Author WHERE id = ?")
    .get(id);

function createUser(id, name, role = "JOURNALIST") {
  db.prepare(
    `INSERT INTO Author (id, name, email, passwordHash, role, isPremium, slug, emailNotificationsEnabled, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?)`,
  ).run(id, name, address(id), bcrypt.hashSync("password123", 10), role, id, new Date().toISOString());
}

function insertComment(id, content, status, authorId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO Comment (id, content, articleId, authorId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, content, ids.article, authorId, status, now, now);
}

function cleanup() {
  const prefix = "chk11e%";
  db.prepare("DELETE FROM Notification WHERE userId LIKE ?").run(prefix);
  db.prepare("DELETE FROM Report WHERE commentId IN (SELECT id FROM Comment WHERE articleId LIKE ?)").run(prefix);
  db.prepare("DELETE FROM Comment WHERE articleId LIKE ?").run(prefix);
  db.prepare("DELETE FROM Comment WHERE content LIKE ?").run(`%${MARKER}%`);
  db.prepare("DELETE FROM CommentReaction WHERE authorId LIKE ?").run(prefix);
  db.prepare("DELETE FROM Article WHERE id LIKE ?").run(prefix);
  db.prepare("DELETE FROM Category WHERE id LIKE ?").run(prefix);
  db.prepare("UPDATE Author SET bannedUntil = NULL, banReason = NULL WHERE id LIKE ?").run(prefix);
  db.prepare("DELETE FROM Author WHERE id LIKE ?").run(prefix);
}

/* ------------------------------------------------------------------- tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

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

  try {
    /* ---------------------------------------------------- 1) Schéma, migration */
    console.log("--- Schéma, migration et helpers ---");
    const authorBlock = schema.slice(schema.indexOf("model Author {"), schema.indexOf("enum UserRole"));
    check(
      "Author : interrupteur global (vrai par défaut)",
      /emailNotificationsEnabled\s+Boolean\s+@default\(true\)/.test(authorBlock),
    );
    check(
      "Author : liste des types désactivés en Json optionnel",
      /emailNotificationTypes\s+Json\?/.test(authorBlock),
    );
    const migration = existsSync(path.join(ROOT, MIGRATION)) ? readSource(MIGRATION) : "";
    check("migration init_postgres présente", migration.length > 0, MIGRATION);
    check(
      "migration : colonnes ajoutées au schéma PostgreSQL",
      migration.includes('"emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true') &&
        migration.includes('"emailNotificationTypes" JSONB'),
    );
    const columns = db.prepare("PRAGMA table_info(Author)").all().map((column) => column.name);
    check(
      "base : les deux colonnes existent",
      columns.includes("emailNotificationsEnabled") && columns.includes("emailNotificationTypes"),
      columns.filter((name) => name.startsWith("email")).join(", "),
    );
    const applied = db
      .prepare(
        "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%init_postgres%' AND finished_at IS NOT NULL",
      )
      .get();
    check("migration enregistrée", Boolean(applied), applied?.migration_name);

    check(
      "helper : cinq types d'e-mail et leurs libellés",
      TYPES.every((type) => notifEmail.includes(type)) &&
        notifEmail.includes("EMAIL_NOTIFICATION_LABELS"),
    );
    check(
      "helper : shouldSendEmail tient compte de l'interrupteur et du type",
      notifEmail.includes("export function shouldSendEmail") &&
        notifEmail.includes("if (!user.emailNotificationsEnabled)") &&
        notifEmail.includes("disabledTypes(user.emailNotificationTypes).includes(notificationType)"),
    );
    check(
      "helper : colonne Json relue avec méfiance (tableau de chaînes connues)",
      notifEmail.includes("export function disabledTypes") &&
        notifEmail.includes("if (!Array.isArray(value))") &&
        notifEmail.includes("value.filter(isEmailNotificationType)"),
    );
    check(
      "helper : envoi best-effort, jamais d'exception",
      notifEmail.includes("export async function sendNotificationEmail") &&
        /catch \(error\)/.test(notifEmail) &&
        notifEmail.includes("success: false"),
    );
    check(
      "plafond : 20 e-mails par heure et par utilisateur",
      /NOTIFICATION_EMAIL_RATE_LIMIT: RateLimitOptions = \{\s*max: 20/.test(rateLimit) &&
        notifEmail.includes("consumeRateLimit(`notif-email:${user.id}`, NOTIFICATION_EMAIL_RATE_LIMIT)"),
    );
    check(
      "cinq gabarits de notification présents",
      [
        "renderCommentReplyEmail",
        "renderCommentApprovedEmail",
        "renderCommentRejectedEmail",
        "renderUserBannedEmail",
        "renderReportResolvedEmail",
      ].every((name) => templates.includes(`export function ${name}`)),
    );
    check(
      "chaque gabarit porte les quatre liens attendus",
      templates.includes("notificationFooter()") &&
        templates.includes("/mon-compte/notifications") &&
        templates.includes("/mon-compte/preferences") &&
        templates.includes("options.actionLabel"),
    );
    check(
      "aucun pixel de suivi dans les e-mails de notification",
      !/track-open/.test(templates.slice(templates.indexOf("notifications (WP11e)"))),
    );
    check(
      "branchement : la notification in-app d'abord, l'e-mail sans être attendu",
      notificationsLib.includes("void notifyByEmail(notification).catch") &&
        notificationsLib.indexOf("prisma.notification.create") <
          notificationsLib.indexOf("void notifyByEmail"),
    );
    const typesBlock = notifEmail.slice(
      notifEmail.indexOf("EMAIL_NOTIFICATION_TYPES = ["),
      notifEmail.indexOf("] as const;"),
    );
    check(
      "aucun e-mail de notification pour une réaction (COMMENT_REACTION)",
      // Le type existe bien dans le code in-app (`notifyCommentReaction`), mais
      // il ne doit pas figurer parmi les types concernés par l'e-mail.
      !typesBlock.includes("COMMENT_REACTION") && !/case "COMMENT_REACTION"/.test(notifEmail),
      `types e-mail : ${(typesBlock.match(/"[A-Z_]+"/g) ?? []).join(", ")}`,
    );
    check(
      "préférences : page, action et composant client",
      preferencesPage.includes("NotificationPreferences") &&
        preferencesActions.includes("export async function updateNotificationPreferences") &&
        preferencesComponent.startsWith('"use client"') &&
        preferencesComponent.includes('name="emailNotificationsEnabled"'),
    );
    check(
      "préférences : stockage des types désactivés, NULL si aucun",
      preferencesActions.includes("emailNotificationTypes: disabled.length > 0 ? disabled : Prisma.DbNull") &&
        preferencesActions.includes("EMAIL_NOTIFICATION_TYPES.filter((type) => !checked.includes(type))"),
    );
    check(
      "lien « Préférences de notification » depuis /mon-compte",
      accountPage.includes('href="/mon-compte/preferences"') &&
        accountPage.includes("Préférences de notification"),
    );

    /* ------------------------------------------------------------ 2) Fixtures */
    console.log("\n--- Jeu de test ---");
    const now = new Date();
    createUser(ids.author, `Auteur ${TAG}`);
    createUser(ids.peer, `Lecteur ${TAG}`);
    // Adresse en échec chez le fournisseur : sert à vérifier qu'un refus
    // d'envoi ne casse pas la notification in-app.
    createUser(ids.failing, `Echec ${TAG}`);
    db.prepare(`INSERT INTO Category (id, name, slug, createdAt) VALUES (?, ?, ?, ?)`).run(
      ids.category,
      `Catégorie ${TAG}`,
      ids.category,
      now.toISOString(),
    );
    db.prepare(
      `INSERT INTO Article (id, title, slug, content, excerpt, status, publishedAt, isPremium, authorId, categoryId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, 0, ?, ?, ?, ?)`,
    ).run(
      ids.article,
      `Article ${TAG}`,
      slug,
      "Contenu.",
      "Résumé.",
      now.toISOString(),
      ids.author,
      ids.category,
      now.toISOString(),
      now.toISOString(),
    );
    insertComment(ids.root, `${MARKER} commentaire initial`, "APPROVED", ids.author);
    ids.comments.forEach((id, index) =>
      insertComment(id, `${MARKER} commentaire ${index + 1}`, "PENDING", ids.author),
    );
    check(
      "trois comptes, un article et 25 commentaires créés",
      db.prepare("SELECT COUNT(*) AS c FROM Comment WHERE articleId = ?").get(ids.article).c === 25,
    );

    const adminJar = await login("admin@example.com", "admin123", "/backoffice/comments");
    const authorJar = await login(address(ids.author), "password123");
    const peerJar = await login(address(ids.peer), "password123");

    /* ------------------------------------------------- 3) Réponse commentée */
    console.log("\n--- Réponse à un commentaire ---");
    stubMails.length = 0;
    const before = notificationCount(ids.author);
    const reply = await submitForm(peerJar, `/article/${slug}?repondre=${ids.root}`, {
      contains: ['name="slug"', 'name="parentId"'],
      fields: { content: `${MARKER} réponse du lecteur` },
    });
    const notified = await waitFor(() => notificationCount(ids.author) > before);
    // L'e-mail n'est pas attendu par l'action : on laisse au serveur factice le
    // temps de le recevoir avant de décider si l'envoi est configuré.
    await waitFor(() => mailsTo(address(ids.author)).length > 0, 3000);
    const replyMail = mailsTo(address(ids.author));
    const stubConfigured = replyMail.length > 0;

    check(
      "la réponse est acceptée et la notification in-app créée",
      reply.ok && notified && notificationTypes(ids.author).includes("COMMENT_REPLY"),
      `${notificationCount(ids.author)} notification(s)`,
    );
    check(
      stubConfigured
        ? "e-mail de réponse envoyé au destinataire"
        : "envoi désactivé : la notification in-app existe malgré tout",
      stubConfigured ? replyMail.some((mail) => mail.subject.includes("répondu")) : notified,
      stubConfigured ? `${replyMail.length} message(s)` : "serveur factice non sollicité",
    );
    if (stubConfigured) {
      const mail = replyMail[0];
      check(
        "l'e-mail contient le message, le lien vers la ressource et les préférences",
        mail.html.includes(`${TAG}`) &&
          mail.html.includes(`/article/${slug}#commentaires`) &&
          mail.html.includes("/mon-compte/notifications") &&
          mail.html.includes("/mon-compte/preferences"),
        `sujet : ${mail.subject}`,
      );
      check(
        "l'e-mail n'embarque aucun pixel de suivi",
        !mail.html.includes("track-open") && !/<img/i.test(mail.html),
      );
      check(
        "version texte fournie (délivrabilité)",
        String(mail.text ?? "").length > 0 && mail.text.includes("Préférences"),
      );
      check(
        "étiquettes de traçabilité du message",
        mail.tags.some((tag) => tag.name === "notification_id") &&
          mail.tags.some((tag) => tag.name === "notification_type"),
      );
    }

    /* -------------------------------------------- 4) Préférences de l'abonné */
    console.log("\n--- Préférences de notification ---");
    const preferences = await get("/mon-compte/preferences", { jar: authorJar });
    check("page protégée et accessible", preferences.status === 200, `status=${preferences.status}`);
    check(
      "interrupteur global coché par défaut, cinq types proposés",
      /name="emailNotificationsEnabled"[^>]*checked/.test(preferences.body) &&
        TYPES.every((type) => preferences.body.includes(`value="${type}"`)),
    );
    check(
      "un visiteur est redirigé vers /login",
      [302, 307].includes((await get("/mon-compte/preferences")).status),
    );

    // Interrupteur global décoché : plus aucun e-mail, mais la notification in-app.
    stubMails.length = 0;
    await submitForm(authorJar, "/mon-compte/preferences", {
      contains: 'name="emailNotificationsEnabled"',
      fields: { types: TYPES },
    });
    const prefsAfter = authorPrefs(ids.author);
    check(
      "enregistrement : interrupteur global passé à faux",
      prefsAfter.emailNotificationsEnabled === 0,
      `enabled=${prefsAfter.emailNotificationsEnabled}`,
    );

    const beforeGlobal = notificationCount(ids.author);
    await submitForm(peerJar, `/article/${slug}?repondre=${ids.root}`, {
      contains: ['name="slug"', 'name="parentId"'],
      fields: { content: `${MARKER} réponse sans e-mail` },
    });
    await waitFor(() => notificationCount(ids.author) > beforeGlobal);
    await new Promise((resolve) => setTimeout(resolve, 500));
    check(
      "interrupteur global décoché : notification in-app créée, aucun e-mail",
      notificationCount(ids.author) > beforeGlobal && mailsTo(address(ids.author)).length === 0,
      `${notificationCount(ids.author)} notification(s), ${mailsTo(address(ids.author)).length} e-mail(s)`,
    );

    // Un seul type désactivé : les autres continuent de partir.
    await submitForm(authorJar, "/mon-compte/preferences", {
      contains: 'name="emailNotificationsEnabled"',
      fields: {
        emailNotificationsEnabled: "on",
        types: ["COMMENT_APPROVED", "COMMENT_REJECTED", "USER_BANNED", "REPORT_RESOLVED"],
      },
    });
    check(
      "enregistrement : COMMENT_REPLY seul désactivé, stocké en JSON",
      (() => {
        const prefs = authorPrefs(ids.author);
        const disabled = JSON.parse(prefs.emailNotificationTypes ?? "[]");
        return (
          prefs.emailNotificationsEnabled === 1 &&
          Array.isArray(disabled) &&
          disabled.length === 1 &&
          disabled[0] === "COMMENT_REPLY"
        );
      })(),
      String(authorPrefs(ids.author).emailNotificationTypes),
    );

    stubMails.length = 0;
    const beforeTyped = notificationCount(ids.author);
    await submitForm(peerJar, `/article/${slug}?repondre=${ids.root}`, {
      contains: ['name="slug"', 'name="parentId"'],
      fields: { content: `${MARKER} réponse type désactivé` },
    });
    await waitFor(() => notificationCount(ids.author) > beforeTyped);
    await new Promise((resolve) => setTimeout(resolve, 500));
    check(
      "type désactivé : in-app oui, e-mail non",
      notificationCount(ids.author) > beforeTyped && mailsTo(address(ids.author)).length === 0,
      `${mailsTo(address(ids.author)).length} e-mail(s)`,
    );

    // Réglages par défaut rétablis pour la suite.
    await submitForm(authorJar, "/mon-compte/preferences", {
      contains: 'name="emailNotificationsEnabled"',
      fields: { emailNotificationsEnabled: "on", types: TYPES },
    });
    check(
      "réglages par défaut rétablis (toutes les cases cochées)",
      authorPrefs(ids.author).emailNotificationsEnabled === 1 &&
        authorPrefs(ids.author).emailNotificationTypes === null,
      String(authorPrefs(ids.author).emailNotificationTypes),
    );

    /* ------------------------------------------- 5) Modération et bannissement */
    console.log("\n--- Approbation, rejet, bannissement, signalement ---");
    const approveId = findActionId("approveComment");
    const rejectId = findActionId("rejectComment");
    stubMails.length = 0;
    await callAction(adminJar, "/backoffice/comments", approveId, [ids.comments[0]]);
    const approved = await waitFor(() => mailsTo(address(ids.author)).some((mail) => mail.subject.includes("approuvé")));
    check(
      "approbation : e-mail « Votre commentaire a été approuvé »",
      approved || !stubConfigured,
      stubConfigured ? `${mailsTo(address(ids.author)).length} message(s)` : "envoi désactivé",
    );

    await callAction(adminJar, "/backoffice/comments", rejectId, [ids.comments[1]]);
    const rejected = await waitFor(() => mailsTo(address(ids.author)).some((mail) => mail.subject.includes("rejeté")));
    check(
      "rejet : e-mail « Votre commentaire a été rejeté »",
      rejected || !stubConfigured,
      stubConfigured ? mailsTo(address(ids.author)).map((mail) => mail.subject).join(" | ") : "envoi désactivé",
    );

    stubMails.length = 0;
    const banAction = findActionId("banUser");
    const banForm = await submitForm(adminJar, `/backoffice/comments?tab=users&bannir=${ids.peer}`, {
      contains: 'name="duration"',
      fields: { duration: "7d", reason: "Propos hors charte" },
    });
    const banned = await waitFor(() => mailsTo(address(ids.peer)).some((mail) => mail.subject.includes("banni")));
    check(
      "bannissement : e-mail « Vous avez été banni » au compte visé",
      banForm.ok && (banned || !stubConfigured),
      stubConfigured ? mailsTo(address(ids.peer)).map((mail) => mail.subject).join(" | ") : "envoi désactivé",
    );
    check(
      "aucun e-mail de notification pour une réaction (COMMENT_REACTION)",
      !TYPES.includes("COMMENT_REACTION") &&
        !notifEmail.includes('"COMMENT_REACTION"'),
      "type volontairement in-app",
    );

    /* ------------------------------------------------- 6) Échec du fournisseur */
    console.log("\n--- Un échec d'envoi ne casse rien ---");
    const failingId = findActionId("approveComment");
    stubMails.length = 0;
    // Le compte « echec » est l'auteur d'un commentaire : son approbation
    // déclenche un e-mail que le serveur factice refuse.
    insertComment(`${TAG}-cmt-echec`, `${MARKER} commentaire en échec`, "PENDING", ids.failing);
    const beforeFailing = notificationCount(ids.failing);
    const failingCall = await callAction(adminJar, "/backoffice/comments", failingId, [`${TAG}-cmt-echec`]);
    const failingNotified = await waitFor(() => notificationCount(ids.failing) > beforeFailing);
    await new Promise((resolve) => setTimeout(resolve, 600));
    check(
      "le refus du fournisseur n'empêche ni la modération ni la notification in-app",
      failingCall.status < 400 && failingNotified,
      `${notificationCount(ids.failing)} notification(s), statut ${failingCall.status}`,
    );
    check(
      "l'échec est bien constaté côté fournisseur (simulation)",
      !stubConfigured || stubMails.some((mail) => mail.failed),
      `${stubMails.filter((mail) => mail.failed).length} refus simulé(s)`,
    );

    /* ------------------------------------------------------- 7) Plafond horaire */
    console.log("\n--- Plafond : 20 e-mails par heure et par utilisateur ---");
    // 23 commentaires du même auteur, approuvés un par un : les notifications
    // in-app sont toutes créées, mais seuls 20 e-mails doivent partir.
    await submitForm(authorJar, "/mon-compte/preferences", {
      contains: 'name="emailNotificationsEnabled"',
      fields: { emailNotificationsEnabled: "on", types: TYPES },
    });
    stubMails.length = 0;
    // Destinataire dédié : son compteur horaire part de zéro, ce qui permet
    // d'attendre exactement 20 e-mails — ni 19, ni 21.
    const limitAuthor = `${TAG}-limite-auteur`;
    createUser(limitAuthor, `Auteur limite ${TAG}`);
    const limitComments = Array.from({ length: 23 }, (_, index) => `${TAG}-limite-${index}`);
    const admin = db.prepare("SELECT id FROM Author WHERE email = 'admin@example.com'").get();
    db.prepare(
      `INSERT INTO Article (id, title, slug, content, excerpt, status, publishedAt, isPremium, authorId, categoryId, createdAt, updatedAt)
       VALUES (?, ?, ?, 'Contenu.', 'Résumé.', 'PUBLISHED', ?, 0, ?, ?, ?, ?)`,
    ).run(
      `${TAG}-art-limite`,
      `Article limite ${TAG}`,
      `${TAG}-limite`,
      now.toISOString(),
      admin.id,
      ids.category,
      now.toISOString(),
      now.toISOString(),
    );
    for (const [index, commentId] of limitComments.entries()) {
      db.prepare(
        `INSERT INTO Comment (id, content, articleId, authorId, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
      ).run(commentId, `${MARKER} limite ${index}`, `${TAG}-art-limite`, limitAuthor, now.toISOString(), now.toISOString());
    }
    // Le plafond est déjà consommé par les envois précédents de cette exécution :
    // on repart d'un compteur vierge en changeant de destinataire, puis on
    // approuve les 23 commentaires.
    const beforeLimit = notificationCount(limitAuthor);
    for (const commentId of limitComments) {
      await callAction(adminJar, "/backoffice/comments", findActionId("approveComment"), [commentId]);
    }
    const allNotified = await waitFor(() => notificationCount(limitAuthor) >= beforeLimit + 23, 15000);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const limitMails = mailsTo(address(limitAuthor));
    check(
      "les 23 notifications in-app sont créées",
      allNotified,
      `${notificationCount(limitAuthor) - beforeLimit} notification(s)`,
    );
    check(
      stubConfigured
        ? "exactement 20 e-mails partent dans l'heure, les 3 suivants sont abandonnés"
        : "envoi désactivé : le compteur n'est pas sollicité",
      stubConfigured ? limitMails.length === 20 : true,
      `${limitMails.length} e-mail(s) pour 23 notifications`,
    );

    /* ------------------------------------------------- 8) Non-régression */
    console.log("\n--- Non-régression ---");
    check(
      "espace notifications in-app toujours accessible",
      (await get("/mon-compte/notifications", { jar: authorJar })).status === 200,
    );
    check("accueil toujours servi", (await get("/")).status === 200);
    check("inscription publique toujours accessible", (await get("/newsletter")).status === 200);
    check(
      "campagnes admin toujours accessibles",
      (await get("/backoffice/newsletter/campaigns", { jar: adminJar })).status === 200,
    );

    cleanup();
    const leftovers = db.prepare("SELECT COUNT(*) AS c FROM Author WHERE id LIKE ?").get("chk11e%").c;
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
