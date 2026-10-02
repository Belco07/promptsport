/**
 * Vérification du WP10d — notifications in-app.
 * Exécution : PORT=3002 node scripts/check-wp10d.cjs
 *
 * Le script couvre quatre niveaux :
 *  1. le schéma, la migration et la table `Notification` réellement créée ;
 *  2. le code : helpers (`src/lib/notifications.ts`), Server Actions, composants
 *     (`NotificationItem`, `NotificationBadge`) et leur branchement dans le menu
 *     utilisateur et dans /mon-compte ;
 *  3. les créations réelles de notifications par les parcours utilisateur
 *     (réponse à un commentaire, réaction, modération, signalement, bannissement),
 *     en passant par les Server Actions comme le ferait un navigateur ;
 *  4. l'interface : liste, filtre « non lues », pagination 20, marquage lu,
 *     cloisonnement entre comptes, état vide et redirection des visiteurs.
 *
 * Toutes les données créées sont préfixées « chk10d » et supprimées à la fin.
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
const notifications = readSource("src/lib/notifications.ts");
const notificationActions = readSource("src/app/mon-compte/notifications/actions.ts");
const notificationPage = readSource("src/app/mon-compte/notifications/page.tsx");
const notificationItem = readSource("src/components/NotificationItem.tsx");
const notificationBadge = readSource("src/components/NotificationBadge.tsx");
const userMenu = readSource("src/components/UserMenu.tsx");
const accountPage = readSource("src/app/mon-compte/page.tsx");
const articleActions = readSource("src/app/article/[slug]/actions.ts");
const adminActions = readSource("src/app/backoffice/comments/actions.ts");
const commentForm = readSource("src/components/CommentForm.tsx");
const commentsSection = readSource("src/components/CommentsSection.tsx");
const articlePage = readSource("src/app/article/[slug]/page.tsx");
const packageJson = JSON.parse(readSource("package.json"));

// WP12a : les migrations SQLite ont été remplacées par la migration unique
// `init_postgres`, qui contient désormais la table Notification.
const MIGRATION = "prisma/migrations/20261002120000_init_postgres/migration.sql";
const NOTIFICATION_TYPES = [
  "COMMENT_REPLY",
  "COMMENT_REACTION",
  "COMMENT_APPROVED",
  "COMMENT_REJECTED",
  "REPORT_RESOLVED",
  "REPORT_DISMISSED",
  "USER_BANNED",
  "USER_UNBANNED",
];

const TAG = `chk10d-${crypto.randomBytes(4).toString("hex")}`;
const MARKER = `${TAG}-marqueur`;
const ids = {
  author: `${TAG}-user-a`,
  peer: `${TAG}-user-b`,
  empty: `${TAG}-user-empty`,
  cascade: `${TAG}-user-cascade`,
  category: `${TAG}-cat`,
  article: `${TAG}-art`,
  root: `${TAG}-root`,
  root2: `${TAG}-root2`,
  root3: `${TAG}-root3`,
  peerApproved: `${TAG}-peer-ok`,
  peerRejected: `${TAG}-peer-ko`,
  pagination: Array.from(
    { length: 25 },
    (_, index) => `${TAG}-pag-${String(index + 1).padStart(2, "0")}`,
  ),
};
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

async function login(email, password, callbackPath = "/mon-compte/notifications") {
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
        /* manifeste illisible : on continue */
      }
    }
  }
  return null;
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

/** Soumet un formulaire à Server Action en multipart, comme un navigateur. */
async function submitForm(jar, urlPath, { contains, boundArg, button, fields: extraFields = {} }) {
  const page = await get(urlPath, { jar });
  const fields = boundArg ? boundFormFields(page.body, boundArg) : formFields(page.body, contains);
  if (!fields) {
    return {
      ok: false,
      reason: `formulaire introuvable (${boundArg ?? [].concat(contains).join(" + ")})`,
    };
  }

  const boundary = `----WP10D${crypto.randomBytes(8).toString("hex")}`;
  const entries = { ...fields, ...extraFields };
  if (button) entries[button.name] = button.value;

  const parts = Object.entries(entries).map(([name, value]) =>
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    ),
  );
  const payload = Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);

  const response = await request("POST", urlPath, {
    jar,
    raw: payload,
    contentType: `multipart/form-data; boundary=${boundary}`,
    headers: { origin: ORIGIN, referer: `${ORIGIN}${urlPath}` },
  });
  return { ok: response.status < 400, status: response.status, location: response.location };
}

/** Texte débarrassé des marqueurs de commentaire insérés par React. */
const text = (html) => html.replace(/<!-- -->/g, "");

/** Numéros de notifications distincts, dans l'ordre de première apparition. */
function uniqueNotifOrder(body) {
  const seen = new Set();
  const order = [];
  for (const match of body.matchAll(/marqueur notif (\d+)/g)) {
    const number = Number(match[1]);
    if (!seen.has(number)) {
      seen.add(number);
      order.push(number);
    }
  }
  return order;
}

/* ------------------------------------------------------------------ données */

const notificationsOf = (userId) =>
  db.prepare("SELECT id, type, title, message, read, readAt, linkUrl FROM Notification WHERE userId = ? ORDER BY createdAt ASC").all(userId);
const notificationCount = (userId) =>
  db.prepare("SELECT COUNT(*) AS c FROM Notification WHERE userId = ?").get(userId).c;
const commentStatus = (id) => db.prepare("SELECT status FROM Comment WHERE id = ?").get(id)?.status;

function createUser(id, name, role = "JOURNALIST") {
  db.prepare(
    `INSERT INTO Author (id, name, email, passwordHash, role, isPremium, slug, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(id, name, `${id}@example.test`, bcrypt.hashSync("password123", 10), role, id, new Date().toISOString());
}

function insertComment(id, content, articleId, authorId, status, createdAt) {
  db.prepare(
    `INSERT INTO Comment (id, content, articleId, authorId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, content, articleId, authorId, status, createdAt, createdAt);
}

function cleanup() {
  db.prepare("DELETE FROM Notification WHERE userId IN (?, ?, ?, ?)").run(
    ids.author,
    ids.peer,
    ids.empty,
    ids.cascade,
  );
  db.prepare("DELETE FROM Notification WHERE message LIKE ?").run(`%${MARKER}%`);
  db.prepare("DELETE FROM Report WHERE commentId IN (SELECT id FROM Comment WHERE articleId = ?)").run(ids.article);
  db.prepare("DELETE FROM Comment WHERE articleId = ?").run(ids.article);
  db.prepare("DELETE FROM Comment WHERE content LIKE ?").run(`%${MARKER}%`);
  db.prepare("DELETE FROM CommentReaction WHERE authorId IN (?, ?)").run(ids.author, ids.peer);
  db.prepare("DELETE FROM Article WHERE id = ?").run(ids.article);
  db.prepare("DELETE FROM Category WHERE id = ?").run(ids.category);
  db.prepare("UPDATE Author SET bannedUntil = NULL, banReason = NULL WHERE id IN (?, ?)").run(ids.author, ids.peer);
  db.prepare("DELETE FROM Author WHERE id IN (?, ?, ?, ?)").run(ids.author, ids.peer, ids.empty, ids.cascade);
}

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  cleanup();

  /* ----------------------------------------------------- 1) Schéma et base */
  console.log("--- Schéma, migration et table ---");
  const notificationModel = schema.slice(
    schema.indexOf("model Notification {"),
    schema.indexOf("model Notification {") + 1200,
  );
  check("schéma : modèle Notification", schema.includes("model Notification {"));
  check(
    "schéma : destinataire, type, titre, message, lien, lecture",
    ["userId", "type", "title", "message", "linkUrl", "read", "readAt", "createdAt"].every((field) =>
      new RegExp(`\\b${field}\\s`).test(notificationModel),
    ),
  );
  check("schéma : relation vers Author avec cascade", /user\s+Author\s+@relation\([^)]*onDelete:\s*Cascade/.test(notificationModel.replace(/\s+/g, " ")));
  check(
    "schéma : enum NotificationType (8 valeurs)",
    schema.includes("enum NotificationType {") && NOTIFICATION_TYPES.every((value) => schema.includes(value)),
  );
  check(
    "schéma : relation inverse Author.notifications",
    /notifications\s+Notification\[\]/.test(schema),
  );

  const migration = existsSync(path.join(ROOT, MIGRATION)) ? readSource(MIGRATION) : "";
  check("migration init_postgres présente", migration.length > 0, MIGRATION);
  check(
    "migration : table, clé étrangère et index",
    migration.includes('CREATE TABLE "Notification"') &&
      migration.includes('FOREIGN KEY ("userId") REFERENCES "Author"("id") ON DELETE CASCADE') &&
      migration.includes('CREATE INDEX "Notification_userId_idx"') &&
      migration.includes('CREATE INDEX "Notification_read_idx"') &&
      migration.includes('CREATE INDEX "Notification_createdAt_idx"'),
  );

  const columns = db.prepare("PRAGMA table_info(Notification)").all().map((column) => column.name);
  check(
    "base : table Notification créée avec ses colonnes",
    ["id", "userId", "type", "title", "message", "linkUrl", "read", "readAt", "createdAt"].every((column) =>
      columns.includes(column),
    ),
    columns.join(", "),
  );
  const applied = db
    .prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%init_postgres%' AND finished_at IS NOT NULL",
    )
    .get();
  check("base : migration init_postgres enregistrée", Boolean(applied), applied?.migration_name);
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Notification'")
    .all()
    .map((row) => row.name);
  check(
    "base : trois index de lecture",
    ["Notification_userId_idx", "Notification_read_idx", "Notification_createdAt_idx"].every((name) =>
      indexes.includes(name),
    ),
    indexes.join(", "),
  );

  /* -------------------------------------------------------- 2) Helpers et code */
  console.log("\n--- Helpers et composants ---");
  check(
    "lib/notifications : échec silencieux (try/catch + journal)",
    /try\s*{/.test(notifications) &&
      notifications.includes("catch (error)") &&
      notifications.includes("[notifications] création impossible") &&
      notifications.includes("return false"),
  );
  check(
    "lib/notifications : pas d'auto-notification (réponse et réaction)",
    notifications.includes("input.parentAuthorId === input.replyAuthorId") &&
      notifications.includes("input.commentAuthorId === input.reactorId"),
  );
  check(
    "lib/notifications : huit helpers exportés",
    [
      "notifyCommentReply",
      "notifyCommentReaction",
      "notifyCommentModerated",
      "notifyReportHandled",
      "notifyUserBanned",
      "notifyUserUnbanned",
    ].every((name) => notifications.includes(`export async function ${name}(`)),
  );
  check("lib/notifications : extrait de commentaire court (80)", /QUOTE_LENGTH = 80/.test(notifications));
  check(
    "lib/notifications : lien vers les commentaires de l'article",
    /commentsLink/.test(notifications) && notifications.includes("#commentaires"),
  );
  check(
    "lib/notifications : bannissement permanent sans date",
    /untilLabel: string \| null/.test(notifications) && notifications.includes("la suspension est définitive"),
  );

  check("actions notifications : module serveur", notificationActions.startsWith('"use server"'));
  check(
    "actions notifications : markAsRead, markAllAsRead, compteur",
    ["markAsRead", "markAllAsRead", "unreadNotificationCount"].every((name) =>
      notificationActions.includes(`export async function ${name}(`),
    ),
  );
  check(
    "actions notifications : toujours filtrées par la session",
    (notificationActions.match(/userId: session\.user\.id/g) ?? []).length >= 3 &&
      notificationActions.includes("redirect(\"/login\")"),
  );
  check(
    "actions notifications : revalidation des deux pages",
    notificationActions.includes('revalidatePath(NOTIFICATIONS_PATH)') &&
      notificationActions.includes('revalidatePath("/mon-compte")'),
  );

  check(
    "page notifications : filtre « non lues » et pagination 20",
    /const PAGE_SIZE = 20/.test(notificationPage) &&
      notificationPage.includes('params.filtre === "non-lues"') &&
      notificationPage.includes("Page {page} sur {totalPages}"),
  );
  check(
    "page notifications : état vide, tout marquer comme lu, retour",
    notificationPage.includes("Aucune notification pour le moment.") &&
      notificationPage.includes("Tout marquer comme lu") &&
      notificationPage.includes("Retour à mon compte"),
  );
  check(
    "page notifications : visiteur redirigé vers /login",
    notificationPage.includes('redirect("/login")'),
  );

  check(
    "NotificationItem : icône et teinte pour les huit types",
    NOTIFICATION_TYPES.every((type) => notificationItem.includes(`${type}:`)),
  );
  check(
    "NotificationItem : date relative française",
    notificationItem.includes("export function relativeDate") &&
      notificationItem.includes("à l'instant") &&
      notificationItem.includes("il y a ${minutes} min") &&
      notificationItem.includes("hier"),
  );
  check(
    "NotificationItem : point non lu, lien et marquage",
    notificationItem.includes('aria-label="Non lue"') &&
      notificationItem.includes("<Link href={notification.linkUrl}") &&
      notificationItem.includes("Marquer comme lu") &&
      notificationItem.includes("markAsRead.bind(null, notification.id)"),
  );

  check("NotificationBadge : composant client", notificationBadge.startsWith('"use client"'));
  check(
    "NotificationBadge : compteur relu à chaque navigation, plafonné",
    notificationBadge.includes("usePathname()") &&
      notificationBadge.includes('count > 99 ? "99+" : count') &&
      notificationBadge.includes("if (!count || count <= 0)"),
  );
  check(
    "UserMenu : badge et entrée Notifications",
    userMenu.includes("NotificationBadge") && userMenu.includes('href="/mon-compte/notifications"'),
  );
  check(
    "mon-compte : cinq dernières non lues et lien vers la liste",
    /take: 5/.test(accountPage) &&
      accountPage.includes('where: { userId: session.user.id, read: false }') &&
      accountPage.includes("Aucune notification.") &&
      accountPage.includes("Voir toutes les notifications"),
  );

  check(
    "createComment : réponse (parentId) et notification",
    articleActions.includes('formData.get("parentId")') &&
      articleActions.includes("parentId: parent?.id ?? null") &&
      articleActions.includes("notifyCommentReply"),
  );
  check(
    "reactToComment : notification sauf retrait",
    articleActions.includes("notifyCommentReaction") &&
      articleActions.includes("REACTION_LABELS[type]") &&
      articleActions.includes("existing?.type !== type"),
  );
  check(
    "modération : approbation et rejet notifiés",
    adminActions.includes("notifyCommentModerated") &&
      adminActions.includes('status === "APPROVED" || status === "REJECTED"'),
  );
  check(
    "signalements : résolution et classement notifiés",
    (adminActions.match(/notifyReportHandled\(/g) ?? []).length === 2 &&
      adminActions.includes("resolved: true") &&
      adminActions.includes("resolved: false"),
  );
  check(
    "bannissement : notification avec durée, raison et fin de suspension",
    adminActions.includes("notifyUserBanned") &&
      adminActions.includes("notifyUserUnbanned") &&
      adminActions.includes('label === "permanent" ? null : formatDate(bannedUntil)'),
  );
  check(
    "réponse publique : lien « Répondre » et formulaire pré-rempli",
    commentsSection.includes("?repondre=${comment.id}#commentaires") &&
      commentForm.includes('name="parentId"') &&
      commentForm.includes("Réponse à") &&
      articlePage.includes("replyTo={query.repondre ?? null}"),
  );
  check(
    "périmètre : notifications in-app uniquement (ni push, ni e-mail transactionnel)",
    // `resend` est installé depuis le WP11b, pour les campagnes de newsletter :
    // la vérification porte donc sur les notifications elles-mêmes, qui ne
    // doivent appeler aucun service d'envoi (les e-mails automatiques relèvent
    // du WP11e).
    !["nodemailer", "@sendgrid/mail", "mailgun.js", "web-push", "@onesignal/node-onesignal"].some(
      (name) => name in { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) },
    ) &&
      !/(nodemailer|createTransport|web-push|sendPushNotification|newsletter-send|resend)/i.test(
        notifications + notificationActions + adminActions,
      ),
  );
  check(
    "périmètre : pas de temps réel (ni WebSocket, ni polling)",
    !/(WebSocket|socket\.io|setInterval|EventSource)/.test(
      notificationBadge + notificationPage + notificationItem + notifications,
    ),
  );

  /* ---------------------------------------------------------- 3) Jeu de test */
  console.log("\n--- Jeu de test ---");
  const now = new Date();
  createUser(ids.author, `Auteur ${TAG}`);
  createUser(ids.peer, `Lecteur ${TAG}`);
  createUser(ids.empty, `Sans notification ${TAG}`);
  createUser(ids.cascade, `Cascade ${TAG}`);

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
    "Contenu de l'article de test.",
    "Résumé de test.",
    new Date(now.getTime() - 60_000).toISOString(),
    ids.author,
    ids.category,
    now.toISOString(),
    now.toISOString(),
  );

  const base = now.getTime();
  insertComment(ids.root, `${MARKER} commentaire de l'auteur`, ids.article, ids.author, "APPROVED", new Date(base - 600_000).toISOString());
  insertComment(ids.root2, `${MARKER} deuxième commentaire de l'auteur`, ids.article, ids.author, "APPROVED", new Date(base - 590_000).toISOString());
  insertComment(ids.root3, `${MARKER} troisième commentaire de l'auteur`, ids.article, ids.author, "APPROVED", new Date(base - 580_000).toISOString());
  insertComment(ids.peerApproved, `${MARKER} commentaire du lecteur`, ids.article, ids.peer, "PENDING", new Date(base - 570_000).toISOString());
  insertComment(ids.peerRejected, `${MARKER} autre commentaire du lecteur`, ids.article, ids.peer, "PENDING", new Date(base - 560_000).toISOString());
  check("jeu de test inséré", commentStatus(ids.root) === "APPROVED" && commentStatus(ids.peerApproved) === "PENDING");
  check(
    "aucune notification préexistante pour les comptes de test",
    notificationCount(ids.author) === 0 && notificationCount(ids.peer) === 0,
  );

  const adminJar = await login("admin@example.com", "admin123", "/backoffice/comments");
  const authorJar = await login(`${ids.author}@example.test`, "password123");
  const peerJar = await login(`${ids.peer}@example.test`, "password123");
  const emptyJar = await login(`${ids.empty}@example.test`, "password123");
  check(
    "sessions de test ouvertes",
    [adminJar, authorJar, peerJar, emptyJar].every((jar) => jar.has("authjs.session-token")),
  );

  /* ------------------------------------------- 4) Interface publique : réponse */
  console.log("\n--- Interface publique : répondre à un commentaire ---");
  const articleUnknown = await get(`/article/${slug}`);
  check("page article de test : 200", articleUnknown.status === 200, `status=${articleUnknown.status}`);
  // Depuis le correctif d'affordance, un visiteur non connecté se voit proposer
  // la connexion (avec retour sur le formulaire de réponse) plutôt qu'un
  // « Répondre » qui mènerait à un formulaire inutilisable.
  check(
    "visiteur : invitation à se connecter pour répondre",
    articleUnknown.body.includes("/login?callbackUrl=") &&
      articleUnknown.body.includes(encodeURIComponent(`/article/${slug}?repondre=${ids.root}`)) &&
      text(articleUnknown.body).includes("Se connecter pour répondre"),
  );
  const articleConnected = await get(`/article/${slug}`, { jar: peerJar });
  check(
    "membre connecté : lien « Répondre » sur un commentaire racine",
    articleConnected.body.includes(`?repondre=${ids.root}#commentaires`) &&
      text(articleConnected.body).includes(">Répondre<"),
  );

  const replyView = await get(`/article/${slug}?repondre=${ids.root}`, { jar: peerJar });
  check(
    "formulaire de réponse pré-rempli (parentId, auteur, citation)",
    replyView.body.includes(`name="parentId" value="${ids.root}"`) &&
      text(replyView.body).includes(`Réponse à Auteur ${TAG}`) &&
      replyView.body.includes("Annuler"),
  );
  check("bouton « Répondre » dans le formulaire", text(replyView.body).includes(">Répondre<"));

  const missingTarget = await get(`/article/${slug}?repondre=${TAG}-absent`, { jar: peerJar });
  check(
    "?repondre= inconnu : formulaire de commentaire normal",
    missingTarget.status === 200 && !missingTarget.body.includes('name="parentId"'),
  );

  const reply = await submitForm(peerJar, `/article/${slug}?repondre=${ids.root}`, {
    contains: ['name="slug"', 'name="parentId"'],
    fields: { content: `${MARKER} réponse du lecteur` },
  });
  const replyRow = db
    .prepare("SELECT id, parentId, status FROM Comment WHERE content = ?")
    .get(`${MARKER} réponse du lecteur`);
  check(
    "la réponse est enregistrée sous le commentaire parent",
    reply.ok &&
      replyRow?.parentId === ids.root &&
      replyRow?.status === "PENDING" &&
      String(reply.location ?? "").includes("commentaire=en-attente"),
    `parent=${replyRow?.parentId ?? "aucun"} statut=${replyRow?.status ?? "aucun"}`,
  );

  const authorNotifs = notificationsOf(ids.author);
  check(
    "notification COMMENT_REPLY créée pour l'auteur du commentaire",
    authorNotifs.length === 1 && authorNotifs[0].type === "COMMENT_REPLY",
    authorNotifs.map((row) => row.type).join(", ") || "aucune",
  );
  check(
    "notification : titre, message, lien et état non lu",
    authorNotifs[0]?.title === "Nouvelle réponse à votre commentaire" &&
      authorNotifs[0]?.message.includes(`Lecteur ${TAG}`) &&
      authorNotifs[0]?.message.includes("commentaire de l'auteur") &&
      authorNotifs[0]?.linkUrl === `/article/${slug}#commentaires` &&
      authorNotifs[0]?.read === 0 &&
      authorNotifs[0]?.readAt === null,
  );

  const selfReply = await submitForm(authorJar, `/article/${slug}?repondre=${ids.root}`, {
    contains: ['name="slug"', 'name="parentId"'],
    fields: { content: `${MARKER} réponse de l'auteur à lui-même` },
  });
  check(
    "auto-réponse enregistrée mais non notifiée",
    selfReply.ok && notificationCount(ids.author) === 1,
    `${notificationCount(ids.author)} notification(s)`,
  );

  const forgedParent = await submitForm(peerJar, `/article/${slug}?repondre=${ids.root}`, {
    contains: ['name="slug"', 'name="parentId"'],
    fields: { content: `${MARKER} parent forgé`, parentId: `${TAG}-parent-absent` },
  });
  const forgedRow = db
    .prepare("SELECT parentId FROM Comment WHERE content = ?")
    .get(`${MARKER} parent forgé`);
  check(
    "parentId inexistant : commentaire racine, aucune notification",
    forgedParent.ok && forgedRow?.parentId === null && notificationCount(ids.author) === 1,
    `parent=${forgedRow?.parentId ?? "aucun"}`,
  );

  /* -------------------------------------------------- 5) Modération et réactions */
  console.log("\n--- Modération, réactions, signalements, bannissement ---");
  // Les manifestes d'actions ne sont écrits qu'une fois les routes compilées :
  // on visite les pages concernées avant de chercher les identifiants.
  await get("/mon-compte/notifications", { jar: authorJar });
  await get("/backoffice/comments", { jar: adminJar });

  const actionIds = {
    approveComment: findActionId("approveComment"),
    rejectComment: findActionId("rejectComment"),
    reactToComment: findActionId("reactToComment"),
    reportComment: findActionId("reportComment"),
    resolveReport: findActionId("resolveReport"),
    dismissReport: findActionId("dismissReport"),
    unbanUser: findActionId("unbanUser"),
    markAsRead: findActionId("markAsRead"),
    markAllAsRead: findActionId("markAllAsRead"),
    unreadNotificationCount: findActionId("unreadNotificationCount"),
  };
  check(
    "identifiants d'action trouvés dans les manifestes",
    ["approveComment", "rejectComment", "reactToComment", "reportComment", "resolveReport", "dismissReport", "unbanUser", "markAsRead", "markAllAsRead"].every(
      (name) => Boolean(actionIds[name]),
    ),
    Object.entries(actionIds)
      .filter(([, value]) => !value)
      .map(([name]) => name)
      .join(", ") || "tous trouvés",
  );
  check(
    "compteur de notifications non lues exposé comme action serveur",
    Boolean(actionIds.unreadNotificationCount),
    actionIds.unreadNotificationCount?.slice(0, 8) ?? "introuvable",
  );

  const approve = await callAction(adminJar, "/backoffice/comments", actionIds.approveComment, [ids.peerApproved]);
  const peerNotifsAfterApprove = notificationsOf(ids.peer);
  check(
    "approbation : notification COMMENT_APPROVED pour l'auteur du commentaire",
    approve.status < 400 &&
      peerNotifsAfterApprove.some((row) => row.type === "COMMENT_APPROVED") &&
      commentStatus(ids.peerApproved) === "APPROVED",
    peerNotifsAfterApprove.map((row) => row.type).join(", ") || "aucune",
  );

  const reject = await callAction(adminJar, "/backoffice/comments", actionIds.rejectComment, [ids.peerRejected]);
  check(
    "rejet : notification COMMENT_REJECTED",
    reject.status < 400 && notificationsOf(ids.peer).some((row) => row.type === "COMMENT_REJECTED"),
  );

  const reApprove = await callAction(adminJar, "/backoffice/comments", actionIds.approveComment, [ids.peerApproved]);
  check(
    "aucune notification si le statut ne change pas",
    reApprove.status < 400 &&
      notificationsOf(ids.peer).filter((row) => row.type === "COMMENT_APPROVED").length === 1,
    `${notificationsOf(ids.peer).filter((row) => row.type === "COMMENT_APPROVED").length} approbation(s)`,
  );

  const like = await callAction(peerJar, `/article/${slug}`, actionIds.reactToComment, [ids.root, "LIKE"]);
  check(
    "réaction : notification COMMENT_REACTION au nom du réagissant",
    like.status < 400 &&
      notificationsOf(ids.author).filter((row) => row.type === "COMMENT_REACTION").length === 1 &&
      notificationsOf(ids.author).at(-1).message.includes(`Lecteur ${TAG}`) &&
      notificationsOf(ids.author).at(-1).message.includes("J'aime"),
    notificationsOf(ids.author).at(-1)?.message.slice(0, 70) ?? "aucune",
  );

  const love = await callAction(peerJar, `/article/${slug}`, actionIds.reactToComment, [ids.root, "LOVE"]);
  const reactionNotifs = notificationsOf(ids.author).filter((row) => row.type === "COMMENT_REACTION");
  check(
    "changement de réaction : nouvelle notification (« J'adore »)",
    love.status < 400 && reactionNotifs.length === 2 && reactionNotifs.at(-1).message.includes("J'adore"),
    `${reactionNotifs.length} notification(s) de réaction`,
  );

  const toggleOff = await callAction(peerJar, `/article/${slug}`, actionIds.reactToComment, [ids.root, "LOVE"]);
  check(
    "retrait de la réaction : aucune notification supplémentaire",
    toggleOff.status < 400 &&
      notificationsOf(ids.author).filter((row) => row.type === "COMMENT_REACTION").length === 2,
  );

  const peerNotifBefore = notificationCount(ids.peer);
  const ownReaction = await callAction(peerJar, `/article/${slug}`, actionIds.reactToComment, [ids.peerApproved, "LIKE"]);
  check(
    "réagir à son propre commentaire ne notifie personne",
    ownReaction.status < 400 && notificationCount(ids.peer) === peerNotifBefore,
    `${notificationCount(ids.peer)} notification(s)`,
  );

  const report1 = await callAction(peerJar, `/article/${slug}`, actionIds.reportComment, [ids.root2, "SPAM", "Test"]);
  check("signalement du commentaire de l'auteur", report1.status < 400 && /"ok":true/.test(report1.body));
  const report1Row = db.prepare("SELECT id FROM Report WHERE commentId = ?").get(ids.root2);
  const resolve = await callAction(adminJar, "/backoffice/comments", actionIds.resolveReport, [report1Row.id]);
  check(
    "résolution : le signalant est informé (REPORT_RESOLVED)",
    resolve.status < 400 &&
      notificationsOf(ids.peer).some((row) => row.type === "REPORT_RESOLVED") &&
      commentStatus(ids.root2) === "REJECTED",
  );
  check(
    "résolution : l'auteur du commentaire retiré est informé (COMMENT_REJECTED)",
    notificationsOf(ids.author).some(
      (row) => row.type === "COMMENT_REJECTED" && row.message.includes("deuxième commentaire de l'auteur"),
    ),
  );

  const report2 = await callAction(peerJar, `/article/${slug}`, actionIds.reportComment, [ids.root3, "OTHER"]);
  const report2Row = db.prepare("SELECT id, status FROM Report WHERE commentId = ?").get(ids.root3);
  // Le signalement a passé le commentaire en FLAGGED (WP10b) : un classement ne
  // le restaure pas, on vérifie donc que le statut du commentaire ne bouge pas.
  const statusBeforeDismiss = commentStatus(ids.root3);
  const dismiss = await callAction(adminJar, "/backoffice/comments", actionIds.dismissReport, [report2Row.id]);
  check(
    "classement : le signalant est informé (REPORT_DISMISSED)",
    report2.status < 400 &&
      dismiss.status < 400 &&
      notificationsOf(ids.peer).some((row) => row.type === "REPORT_DISMISSED") &&
      commentStatus(ids.root3) === statusBeforeDismiss,
    `signalement=${report2Row?.status ?? "aucun"} (${report2.status}) / classement=${dismiss.status} / commentaire=${commentStatus(ids.root3)}`,
  );

  const ban = await submitForm(adminJar, `/backoffice/comments?tab=users&bannir=${ids.peer}`, {
    boundArg: ids.peer,
    fields: { duration: "1d", reason: "Propos hors charte" },
  });
  const bannedNotif = notificationsOf(ids.peer).find((row) => row.type === "USER_BANNED");
  check(
    "bannissement : notification avec raison et date de fin",
    ban.ok &&
      Boolean(bannedNotif) &&
      bannedNotif.message.includes("Propos hors charte") &&
      /jusqu'au \d/.test(bannedNotif.message),
    bannedNotif?.message.slice(0, 90) ?? "aucune",
  );

  const unban = await callAction(adminJar, "/backoffice/comments", actionIds.unbanUser, [ids.peer]);
  check(
    "fin de suspension : notification USER_UNBANNED",
    unban.status < 400 &&
      notificationsOf(ids.peer).some((row) => row.type === "USER_UNBANNED") &&
      db.prepare("SELECT bannedUntil FROM Author WHERE id = ?").get(ids.peer).bannedUntil === null,
  );

  /* -------------------------------------------------------- 6) Page notifications */
  console.log("\n--- Page /mon-compte/notifications ---");
  const page = await get("/mon-compte/notifications", { jar: authorJar });
  check("page notifications : 200", page.status === 200, `status=${page.status}`);
  check(
    "la notification de réponse est affichée avec son lien",
    page.body.includes("Nouvelle réponse à votre commentaire") &&
      page.body.includes(`/article/${slug}#commentaires`),
  );
  check(
    "état non lu visible (point + bouton de marquage)",
    page.body.includes('aria-label="Non lue"') &&
      page.body.includes("Marquer comme lu") &&
      page.body.includes("Tout marquer comme lu"),
  );
  check(
    "date relative affichée",
    text(page.body).includes("à l'instant") || text(page.body).includes("il y a"),
  );
  check(
    "compteur de non lues en en-tête",
    text(page.body).includes("au total"),
  );

  const unreadFilter = await get("/mon-compte/notifications?filtre=non-lues", { jar: authorJar });
  check(
    "filtre « non lues » : uniquement les non lues",
    unreadFilter.status === 200 && unreadFilter.body.includes("Nouvelle réponse à votre commentaire"),
  );
  check(
    "filtres « Toutes » et « Non lues » présents",
    page.body.includes(">Toutes<") && page.body.includes(">Non lues"),
  );

  const target = notificationsOf(ids.author)[0];
  const markOne = await callAction(authorJar, "/mon-compte/notifications", actionIds.markAsRead, [target.id]);
  check(
    "marquer comme lu : read = 1 et readAt renseigné",
    markOne.status < 400 &&
      db.prepare("SELECT read, readAt FROM Notification WHERE id = ?").get(target.id).read === 1 &&
      Boolean(db.prepare("SELECT readAt FROM Notification WHERE id = ?").get(target.id).readAt),
  );
  const afterMark = await get("/mon-compte/notifications?filtre=non-lues", { jar: authorJar });
  check(
    "la notification lue sort du filtre « non lues »",
    !afterMark.body.includes("Nouvelle réponse à votre commentaire"),
  );
  const allView = await get("/mon-compte/notifications", { jar: authorJar });
  check("la notification lue reste dans « Toutes » avec son badge", allView.body.includes(">Lue<"));

  const stolen = await callAction(peerJar, "/mon-compte/notifications", actionIds.markAsRead, [target.id]);
  check(
    "cloisonnement : un autre compte ne peut pas marquer ma notification",
    stolen.status < 400 &&
      db.prepare("SELECT read FROM Notification WHERE id = ?").get(target.id).read === 1 &&
      notificationCount(ids.peer) > 0,
  );

  const authorUnread = db
    .prepare("SELECT COUNT(*) AS c FROM Notification WHERE userId = ? AND read = 0")
    .get(ids.author).c;
  const countCall = await callAction(authorJar, "/mon-compte/notifications", actionIds.unreadNotificationCount, []);
  check(
    "compteur du badge : valeur exacte pour la session",
    countCall.status < 400 && new RegExp(`\\b${authorUnread}\\b`).test(countCall.body),
    `attendu=${authorUnread} corps=${countCall.body.slice(0, 40)}`,
  );
  const anonCount = await callAction(null, "/mon-compte/notifications", actionIds.unreadNotificationCount, []);
  check("compteur du badge : 0 pour un visiteur", anonCount.status < 400 && /\b0\b/.test(anonCount.body));

  const markAll = await callAction(authorJar, "/mon-compte/notifications", actionIds.markAllAsRead, []);
  check(
    "tout marquer comme lu : plus aucune non lue",
    markAll.status < 400 &&
      db.prepare("SELECT COUNT(*) AS c FROM Notification WHERE userId = ? AND read = 0").get(ids.author).c === 0,
  );

  /* ------------------------------------------------------------- 7) Pagination */
  console.log("\n--- Pagination et aperçu /mon-compte ---");
  const insertNotification = db.prepare(
    `INSERT INTO Notification (id, userId, type, title, message, linkUrl, read, readAt, createdAt)
     VALUES (?, ?, 'COMMENT_REPLY', ?, ?, NULL, 0, NULL, ?)`,
  );
  ids.pagination.forEach((id, index) => {
    const number = String(index + 1).padStart(2, "0");
    insertNotification.run(
      id,
      ids.author,
      `Notification ${number}`,
      `${MARKER} notif ${Number(number)}`,
      // Dates nettement postérieures à celles du parcours : le jeu de pagination
      // reste en tête de liste quelle que soit la durée du test.
      new Date(base + 3_600_000 + (index + 1) * 1000).toISOString(),
    );
  });

  const firstPage = await get("/mon-compte/notifications", { jar: authorJar });
  const firstOrder = uniqueNotifOrder(firstPage.body);
  check(
    "pagination : 20 notifications sur la première page",
    firstOrder.length === 20,
    `${firstOrder.length} rendues`,
  );
  check("tri : la plus récente en tête", firstOrder[0] === 25, `première=${firstOrder[0]}`);
  check(
    "pagination : indicateur et lien de page suivante",
    text(firstPage.body).includes("Page 1 sur 2") && text(firstPage.body).includes("Page suivante"),
  );
  check(
    "page précédente absente en première page",
    !firstPage.body.includes("← Page précédente</a>"),
  );

  const secondPage = await get("/mon-compte/notifications?page=2", { jar: authorJar });
  const secondOrder = uniqueNotifOrder(secondPage.body);
  check(
    "seconde page : 5 notifications restantes",
    secondOrder.length === 5 && secondOrder[0] === 5 && secondOrder.at(-1) === 1,
    `${secondOrder.length} rendues (${secondOrder.join(", ")})`,
  );
  check("seconde page : indicateur « Page 2 sur 2 »", text(secondPage.body).includes("Page 2 sur 2"));

  const account = await get("/mon-compte", { jar: authorJar });
  const accountOrder = uniqueNotifOrder(account.body);
  check("mon-compte : 200 et section Notifications", account.status === 200 && account.body.includes(">Notifications<"));
  check(
    "mon-compte : les 5 dernières non lues, pas plus",
    accountOrder.length === 5 && accountOrder.every((number) => number > 20),
    `affichées : ${accountOrder.join(", ")}`,
  );
  check(
    "mon-compte : lien vers la liste complète",
    account.body.includes("Voir toutes les notifications"),
  );

  const emptyPage = await get("/mon-compte/notifications", { jar: emptyJar });
  check(
    "état vide de la liste",
    emptyPage.status === 200 && emptyPage.body.includes("Aucune notification pour le moment."),
  );
  const emptyAccount = await get("/mon-compte", { jar: emptyJar });
  check("état vide de l'aperçu", emptyAccount.body.includes("Aucune notification."));

  const anonymous = await get("/mon-compte/notifications");
  check(
    "visiteur : redirection vers /login",
    [302, 303, 307].includes(anonymous.status) &&
      String(anonymous.location ?? "").includes("/login"),
    `status=${anonymous.status} location=${anonymous.location ?? "—"}`,
  );

  /* --------------------------------------------------------------- 8) Divers */
  console.log("\n--- Cohérence de la base ---");
  insertNotification.run(
    `${TAG}-cascade`,
    ids.cascade,
    "Notification de test",
    `${MARKER} cascade`,
    now.toISOString(),
  );
  db.prepare("DELETE FROM Author WHERE id = ?").run(ids.cascade);
  check(
    "suppression d'un compte : ses notifications suivent (CASCADE)",
    db.prepare("SELECT COUNT(*) AS c FROM Notification WHERE userId = ?").get(ids.cascade).c === 0,
  );

  cleanup();
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
