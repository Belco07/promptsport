/**
 * Vérification du WP10a — modèle de données de l'engagement et administration.
 * Exécution : PORT=3002 node scripts/check-wp10a.cjs
 *
 * Le script contrôle le schéma Prisma, l'application réelle de la migration
 * (tables, index uniques, actions de clé étrangère), le comportement des
 * contraintes d'unicité, les suppressions en cascade, puis l'interface
 * /backoffice/comments : accès par rôle, deux onglets, données affichées et
 * actions « Supprimer » / « Résoudre ».
 *
 * Toutes les données créées portent un préfixe « chk10a- » et sont supprimées à
 * la fin (la suppression de l'article de test emporte le reste par cascade).
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
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

const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const engagement = readFileSync(path.join(ROOT, "src/lib/engagement.ts"), "utf8");

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

function request(method, urlPath, { jar, form, headers: extra } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = { ...(extra ?? {}) };
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
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

async function login(email, password) {
  const jar = createJar();
  await get("/login", { jar });
  const csrfBody = (await get("/api/auth/csrf", { jar })).body;
  if (!csrfBody.includes("csrfToken")) {
    throw new Error(`Le port ${PORT} ne sert pas promptsport (aucun jeton CSRF).`);
  }
  const csrf = JSON.parse(csrfBody).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/backoffice/comments` },
  });
  return jar;
}

/** Corps multipart, format attendu par les formulaires à Server Action. */
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

/**
 * Soumet un formulaire à Server Action en mode « amélioration progressive » :
 * Next place l'identifiant de l'action dans un champ caché `$ACTION_ID_…` du
 * formulaire, et la requête doit être en multipart/form-data.
 */
async function submitAction(jar, urlPath, fields) {
  const page = await get(urlPath, { jar });
  const forms = page.body.split(/<form/i).slice(1);
  const form = forms.find((chunk) => chunk.includes('name="id"'));
  if (!form) {
    return { ok: false, reason: "formulaire d'action introuvable" };
  }
  const actionId = form.match(/name="\$ACTION_ID_([0-9a-f]+)"/)?.[1];
  if (!actionId) {
    return { ok: false, reason: "champ $ACTION_ID_ introuvable dans le formulaire" };
  }

  const boundary = `----WP10A${crypto.randomBytes(8).toString("hex")}`;
  const payload = multipart({ ...fields, [`$ACTION_ID_${actionId}`]: "" }, boundary);

  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: urlPath,
        method: "POST",
        headers: {
          cookie: jar.header(),
          origin: ORIGIN,
          referer: `${ORIGIN}${urlPath}`,
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "content-length": payload.length,
        },
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          jar.absorb(res.headers["set-cookie"]);
          resolve({ status: res.statusCode });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

  return { ok: response.status < 400, status: response.status };
}

/* ------------------------------------------------------------------ tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

const ids = {
  article: `chk10a-art-${crypto.randomBytes(6).toString("hex")}`,
  category: `chk10a-cat-${crypto.randomBytes(6).toString("hex")}`,
  comment: `chk10a-cmt-${crypto.randomBytes(6).toString("hex")}`,
  reply: `chk10a-rep-${crypto.randomBytes(6).toString("hex")}`,
  commentReaction: `chk10a-crx-${crypto.randomBytes(6).toString("hex")}`,
  articleReaction: `chk10a-arx-${crypto.randomBytes(6).toString("hex")}`,
  report: `chk10a-rpt-${crypto.randomBytes(6).toString("hex")}`,
};

function cleanup() {
  // La suppression de l'article de test emporte commentaires, réactions et
  // signalements par cascade (c'est aussi l'un des contrôles du script).
  db.prepare("DELETE FROM Article WHERE id = ?").run(ids.article);
  db.prepare("DELETE FROM Category WHERE id = ?").run(ids.category);
  db.prepare("DELETE FROM Comment WHERE id IN (?, ?)").run(ids.comment, ids.reply);
  db.prepare("DELETE FROM CommentReaction WHERE id = ?").run(ids.commentReaction);
  db.prepare("DELETE FROM ArticleReaction WHERE id = ?").run(ids.articleReaction);
  db.prepare("DELETE FROM Report WHERE id = ?").run(ids.report);
}

async function main() {
  /* ------------------------------------------------------- 1) Modèle Prisma */
  console.log("--- Schéma Prisma ---");
  for (const model of ["Comment", "CommentReaction", "ArticleReaction", "Report"]) {
    check(`modèle ${model}`, new RegExp(`model ${model} \\{`).test(schema));
  }
  for (const value of ["CommentStatus", "ReactionType", "ReportReason", "ReportStatus"]) {
    check(`enum ${value}`, new RegExp(`enum ${value} \\{`).test(schema));
  }
  check(
    "Comment : champs du brief",
    ["content", "articleId", "authorId", "parentId", "status", "editedAt"].every((field) =>
      new RegExp(`\\b${field}\\b`).test(schema.slice(schema.indexOf("model Comment {"), schema.indexOf("model CommentReaction"))),
    ),
  );
  const commentBlock = schema.slice(schema.indexOf("model Comment {"), schema.indexOf("model CommentReaction"));
  check(
    "Comment : index articleId / authorId / status / createdAt",
    ["@@index([articleId])", "@@index([authorId])", "@@index([status])", "@@index([createdAt])"].every(
      (index) => commentBlock.includes(index),
    ),
  );
  check(
    "Comment : réponses imbriquées (relation CommentReplies)",
    commentBlock.includes('@relation("CommentReplies"') && commentBlock.includes("replies"),
  );
  check(
    "CommentReaction : unicité [commentId, authorId]",
    schema.includes("@@unique([commentId, authorId])"),
  );
  check(
    "ArticleReaction : unicité [articleId, authorId]",
    schema.includes("@@unique([articleId, authorId])"),
  );
  check(
    "Report : unicité [commentId, reporterId]",
    schema.includes("@@unique([commentId, reporterId])"),
  );

  const authorBlock = schema.slice(schema.indexOf("model Author {"), schema.indexOf("enum UserRole"));
  check(
    "Author : relations comments / reactions / reports (Reporter + Resolver)",
    ["comments", "commentReactions", "articleReactions", '@relation("Reporter")', '@relation("Resolver")'].every(
      (needle) => authorBlock.includes(needle),
    ),
  );
  const articleBlock = schema.slice(schema.indexOf("model Article {"), schema.indexOf("// ---"));
  check(
    "Article : relations comments et reactions",
    articleBlock.includes("comments") && articleBlock.includes("reactions"),
  );
  check(
    "ReactionType unique et partagé (LIKE/DISLIKE/LOVE/LAUGH/BOOKMARK)",
    (schema.match(/enum ReactionType/g) ?? []).length === 1 &&
      ["LIKE", "DISLIKE", "LOVE", "LAUGH", "BOOKMARK"].every((value) =>
        schema.slice(schema.indexOf("enum ReactionType")).includes(value),
      ),
  );
  check(
    "lib/engagement : sous-ensembles par usage documentés",
    engagement.includes("COMMENT_REACTION_TYPES") &&
      engagement.includes("ARTICLE_REACTION_TYPES") &&
      engagement.includes('"BOOKMARK"'),
  );

  /* -------------------------------------------------- 2) Migration appliquée */
  console.log("\n--- Migration et contraintes en base ---");
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  for (const table of ["Comment", "CommentReaction", "ArticleReaction", "Report"]) {
    check(`table ${table} créée`, tables.includes(table));
  }
  const applied = db
    .prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%init_postgres%' AND finished_at IS NOT NULL",
    )
    .get();
  // WP12a : les migrations SQLite ont été remplacées par une migration unique
  // `init_postgres` qui crée le schéma PostgreSQL complet, dont ces modèles.
  check("migration init_postgres (schéma PostgreSQL) appliquée", Boolean(applied), applied?.migration_name);

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => row.name);
  check(
    "index uniques en base",
    [
      "CommentReaction_commentId_authorId_key",
      "ArticleReaction_articleId_authorId_key",
      "Report_commentId_reporterId_key",
    ].every((name) => indexes.includes(name)),
  );
  // WP12a : `sqlite_master.sql` n'existe plus ; les actions de clé étrangère
  // sont lues dans le catalogue PostgreSQL (pg_constraint), seule source de
  // vérité pour le schéma réellement appliqué.
  const foreignKeys = (table) =>
    db
      .prepare(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conrelid = ?::regclass AND contype = 'f'`,
      )
      .all(`"${table}"`)
      .map((row) => row.def);
  const ddl = Object.fromEntries(
    ["Comment", "CommentReaction", "ArticleReaction", "Report"].map((table) => [
      table,
      foreignKeys(table).join("\n"),
    ]),
  );
  check(
    "clés étrangères en cascade",
    ["Comment", "CommentReaction", "ArticleReaction", "Report"].every(
      (table) => (ddl[table].match(/ON DELETE CASCADE/g) ?? []).length >= 2,
    ),
    `Comment:${(ddl.Comment.match(/CASCADE/g) ?? []).length} Report:${(ddl.Report.match(/CASCADE/g) ?? []).length} + SET NULL`,
  );
  check(
    "Report.resolvedBy : ON DELETE SET NULL",
    ddl.Report.includes("ON DELETE SET NULL"),
  );
  check(
    "Comment : auto-référence en cascade",
    /FOREIGN KEY \("parentId"\) REFERENCES "Comment"\(id\) ON UPDATE CASCADE ON DELETE CASCADE/.test(ddl.Comment),
  );

  /* ----------------------------------------------- 3) Données et relations */
  console.log("\n--- Relations, unicité et cascade ---");
  cleanup();

  const author = db.prepare("SELECT id FROM Author ORDER BY createdAt LIMIT 1").get();
  const reporter = db.prepare("SELECT id FROM Author ORDER BY createdAt LIMIT 1 OFFSET 1").get();
  check("auteurs de test disponibles", Boolean(author?.id && reporter?.id));

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO Category (id, name, slug, createdAt) VALUES (?, ?, ?, ?)`,
  ).run(ids.category, `chk10a ${ids.category}`, ids.category, now);
  db.prepare(
    `INSERT INTO Article (id, title, slug, content, status, isPremium, authorId, categoryId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'DRAFT', 0, ?, ?, ?, ?)`,
  ).run(ids.article, "Article de test WP10a", ids.article, "Contenu de test.", author.id, ids.category, now, now);

  db.prepare(
    `INSERT INTO Comment (id, content, articleId, authorId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
  ).run(ids.comment, "Premier commentaire de vérification, avec un texte assez long pour être tronqué dans le tableau d'administration.", ids.article, author.id, now, now);
  db.prepare(
    `INSERT INTO Comment (id, content, articleId, authorId, parentId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
  ).run(ids.reply, "Réponse au premier commentaire.", ids.article, reporter.id, ids.comment, now, now);

  const tree = db
    .prepare("SELECT parentId FROM Comment WHERE id = ?")
    .get(ids.reply);
  check("réponse rattachée à son commentaire parent", tree?.parentId === ids.comment);

  db.prepare(
    `INSERT INTO CommentReaction (id, commentId, authorId, type, createdAt) VALUES (?, ?, ?, 'LIKE', ?)`,
  ).run(ids.commentReaction, ids.comment, reporter.id, now);
  db.prepare(
    `INSERT INTO ArticleReaction (id, articleId, authorId, type, createdAt) VALUES (?, ?, ?, 'BOOKMARK', ?)`,
  ).run(ids.articleReaction, ids.article, author.id, now);
  db.prepare(
    `INSERT INTO Report (id, commentId, reporterId, reason, details, status, createdAt)
     VALUES (?, ?, ?, 'SPAM', 'Signalement de test', 'PENDING', ?)`,
  ).run(ids.report, ids.comment, reporter.id, now);

  const join = db
    .prepare(
      `SELECT c.content AS comment, a.slug AS slug, au.name AS authorName
       FROM Comment c JOIN Article a ON a.id = c.articleId JOIN Author au ON au.id = c.authorId
       WHERE c.id = ?`,
    )
    .get(ids.comment);
  check("jointures commentaire → article et auteur", Boolean(join?.slug && join?.authorName), `${join?.slug} / ${join?.authorName}`);

  let duplicateCommentReaction = false;
  try {
    db.prepare(
      `INSERT INTO CommentReaction (id, commentId, authorId, type, createdAt) VALUES (?, ?, ?, 'LOVE', ?)`,
    ).run(`chk10a-dup-${crypto.randomBytes(4).toString("hex")}`, ids.comment, reporter.id, now);
  } catch {
    duplicateCommentReaction = true;
  }
  check("unicité : deux réactions du même auteur sur un commentaire refusées", duplicateCommentReaction);

  let duplicateArticleReaction = false;
  try {
    db.prepare(
      `INSERT INTO ArticleReaction (id, articleId, authorId, type, createdAt) VALUES (?, ?, ?, 'LIKE', ?)`,
    ).run(`chk10a-dup-${crypto.randomBytes(4).toString("hex")}`, ids.article, author.id, now);
  } catch {
    duplicateArticleReaction = true;
  }
  check("unicité : deux réactions du même auteur sur un article refusées", duplicateArticleReaction);

  let duplicateReport = false;
  try {
    db.prepare(
      `INSERT INTO Report (id, commentId, reporterId, reason, status, createdAt) VALUES (?, ?, ?, 'OTHER', 'PENDING', ?)`,
    ).run(`chk10a-dup-${crypto.randomBytes(4).toString("hex")}`, ids.comment, reporter.id, now);
  } catch {
    duplicateReport = true;
  }
  check("unicité : deux signalements du même commentaire par le même auteur refusés", duplicateReport);

  /* ------------------------------------------------- 4) Helpers d'affichage */
  console.log("\n--- Helpers (src/lib/engagement.ts) ---");
  check("limite de 5000 caractères déclarée", /COMMENT_MAX_LENGTH = 5000/.test(engagement));
  check(
    "libellés des 5 statuts de commentaire",
    ["PENDING", "APPROVED", "REJECTED", "FLAGGED", "DELETED"].every((status) =>
      new RegExp(`${status}: "`).test(engagement),
    ),
  );
  check(
    "libellés des 5 raisons de signalement",
    ["SPAM", "HARASSMENT", "HATE_SPEECH", "MISINFORMATION", "OTHER"].every((reason) =>
      new RegExp(`${reason}: "`).test(engagement),
    ),
  );
  check(
    "libellés des 4 statuts de signalement",
    ["PENDING", "REVIEWED", "RESOLVED", "DISMISSED"].every((status) =>
      new RegExp(`${status}: "`).test(engagement),
    ),
  );
  check("extrait normalisé (espaces compactés et troncature)", /replace\(\/\\s\+\/g, " "\)/.test(engagement));

  /* -------------------------------------------------- 5) Administration */
  console.log("\n--- /backoffice/comments ---");
  const anon = await get("/backoffice/comments");
  check("visiteur : redirigé vers /login", anon.status === 307 && anon.location === "/login", `${anon.status} ${anon.location}`);

  const journalistJar = await login("journalist@example.com", "password123");
  check("session JOURNALIST ouverte", journalistJar.has("authjs.session-token"));
  const journalist = await get("/backoffice/comments", { jar: journalistJar });
  check("JOURNALIST : redirigé vers /studio", journalist.status === 307 && journalist.location === "/studio", `${journalist.status} ${journalist.location}`);

  const adminJar = await login("admin@example.com", "admin123");
  check("session ADMIN ouverte", adminJar.has("authjs.session-token"));

  const page = await get("/backoffice/comments", { jar: adminJar });
  check("ADMIN : page accessible", page.status === 200, `status=${page.status}`);
  // Depuis le WP10c, la page compte trois onglets (`?tab=`). Cette suite vérifie
  // que les données du WP10a y sont visibles ; le comportement des actions de
  // modération est couvert par scripts/check-wp10c.cjs.
  check(
    "onglets de modération présents",
    ["tab=comments", "tab=reports", "tab=users"].every((link) => page.body.includes(link)),
  );
  const excerpt = "Premier commentaire de vérification, avec un texte assez long pour être tronqué";
  check("commentaire de test listé (extrait)", page.body.includes(excerpt.slice(0, 60)));
  check("auteur du commentaire affiché", page.body.includes("Admin Test") || page.body.includes("Journaliste Test"));
  check("lien vers l'article du commentaire", page.body.includes(`/article/${ids.article}`));
  check("statut affiché", page.body.includes("En attente"));
  check(
    "actions de modération présentes sur la ligne",
    page.body.includes(">Approuver<") && page.body.includes(">Supprimer<"),
  );

  const reportsPage = await get("/backoffice/comments?tab=reports", { jar: adminJar });
  check("onglet signalements accessible", reportsPage.status === 200, `status=${reportsPage.status}`);
  check("raison du signalement affichée", reportsPage.body.includes("Spam"));
  check("statut du signalement affiché", reportsPage.body.includes("À traiter"));
  check("action Résoudre disponible", reportsPage.body.includes(">Résoudre<"));

  const dashboard = await get("/backoffice", { jar: adminJar });
  check(
    "tableau de bord : lien et compteurs des commentaires",
    dashboard.body.includes('href="/backoffice/comments"') && dashboard.body.includes("Commentaires ("),
  );

  /* ------------------------------------------------------- 6) Les actions */
  console.log("\n--- Actions d'administration ---");
  // Les actions vivent désormais dans actions.ts (WP10c) et sont liées aux
  // formulaires de ligne : on vérifie ici qu'elles sont bien branchées, leur
  // exécution de bout en bout étant contrôlée par check-wp10c.cjs.
  const actionsSource = readFileSync(
    path.join(ROOT, "src/app/backoffice/comments/actions.ts"),
    "utf8",
  );
  check(
    "actions de modération exportées (WP10c)",
    ["approveComment", "rejectComment", "deleteComment", "resolveReport", "dismissReport"].every((name) =>
      new RegExp(`export async function ${name}\\(`).test(actionsSource),
    ),
  );
  check(
    "formulaires de ligne liés à leur action ($ACTION_REF_)",
    /\$ACTION_REF_/.test(page.body),
  );
  const inlineStatus = db.prepare("SELECT status FROM Comment WHERE id = ?").get(ids.comment)?.status;
  check("commentaire de test toujours en attente", inlineStatus === "PENDING", String(inlineStatus));

  /* ------------------------------------------------- 7) Périmètre respecté */
  console.log("\n--- Périmètre du lot ---");
  const articlePage = await get(`/article/psg-victoire-ligue-des-champions`);
  check(
    "aucune modération publique exposée (pas d'action de modération dans le HTML public)",
    articlePage.status === 200 &&
      !/ACtion|Approuver|Rejeter/.test(articlePage.body) &&
      !/backoffice\/comments/.test(articlePage.body),
  );
  check(
    "aucun composant client ajouté pour l'administration",
    !readFileSync(path.join(ROOT, "src/app/backoffice/comments/page.tsx"), "utf8").includes('"use client"'),
  );
  const backofficeLinks = readFileSync(path.join(ROOT, "src/app/backoffice/BackofficeNav.tsx"), "utf8");
  check("lien « Commentaires » dans la navigation du backoffice", backofficeLinks.includes('href="/backoffice/comments"'));

  /* ------------------------------------------------------------ 8) Cascade */
  db.prepare("DELETE FROM Article WHERE id = ?").run(ids.article);
  const leftovers = [
    db.prepare("SELECT COUNT(*) AS c FROM Comment WHERE articleId = ?").get(ids.article).c,
    db.prepare("SELECT COUNT(*) AS c FROM ArticleReaction WHERE articleId = ?").get(ids.article).c,
    db.prepare("SELECT COUNT(*) AS c FROM Report WHERE id = ?").get(ids.report).c,
    db.prepare("SELECT COUNT(*) AS c FROM CommentReaction WHERE id = ?").get(ids.commentReaction).c,
  ];
  check(
    "suppression de l'article : commentaires, réactions et signalements emportés",
    leftovers.every((count) => count === 0),
    `restes : ${leftovers.join(", ")}`,
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
