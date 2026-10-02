/**
 * Vérification du WP10c — modération des commentaires.
 * Exécution : PORT=3002 node scripts/check-wp10c.cjs
 *
 * Le script vérifie le schéma et la migration (bannissement), les helpers, les
 * Server Actions (individuelles, groupées, signalements, bannissement), les
 * trois onglets de /backoffice/comments avec leurs filtres et leur pagination,
 * puis l'interface publique : seuls les commentaires approuvés sont visibles et
 * un auteur banni ne peut plus publier.
 *
 * Les soumissions de formulaire reproduisent ce que ferait un navigateur sans
 * JavaScript : on récupère tous les champs cachés du formulaire visé (y compris
 * ceux des Server Actions liées et de la sélection multiple) et on les poste en
 * multipart/form-data avec le bouton cliqué.
 *
 * Toutes les données créées sont préfixées « chk10c » et supprimées à la fin.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
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

const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
const engagement = readFileSync(path.join(ROOT, "src/lib/engagement.ts"), "utf8");
const actionsSource = readFileSync(
  path.join(ROOT, "src/app/backoffice/comments/actions.ts"),
  "utf8",
);

const TAG = `chk10c-${crypto.randomBytes(4).toString("hex")}`;
const ids = {
  author: `chk10c-user-${crypto.randomBytes(6).toString("hex")}`,
  category: `${TAG}-cat`,
  article: `${TAG}-art`,
  comments: [1, 2, 3].map((n) => `${TAG}-cmt-${n}`),
  bulk: [1, 2, 3].map((n) => `${TAG}-bulk-${n}`),
  reports: [1, 2].map((n) => `${TAG}-rpt-${n}`),
  pagination: Array.from({ length: 55 }, (_, index) => `${TAG}-pg-${String(index).padStart(2, "0")}`),
};
const PUBLIC_ARTICLE_SLUG = "psg-victoire-ligue-des-champions";
const MARKER = `${TAG}-marqueur`;

/** Slug de l'article publié utilisé pour les tests d'interface publique. */
function publicArticleSlug() {
  return db.prepare("SELECT slug FROM Article WHERE id = ?").get(publicArticleId())?.slug ?? PUBLIC_ARTICLE_SLUG;
}

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

/**
 * Champs cachés du premier formulaire contenant TOUS les extraits demandés.
 *
 * Attention : React rend les champs de Server Action sans attribut `value`
 * (`<input type="hidden" name="$ACTION_ID_…"/>`), et une action liée (`.bind`)
 * produit un `$ACTION_REF_n` accompagné de `$ACTION_n:0` / `$ACTION_n:1` où les
 * arguments sont échappés en HTML.
 */
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
    const value = tag.match(/value="([^"]*)"/)?.[1] ?? "";
    fields[name] = value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }
  return fields;
}

/**
 * Champs d'un formulaire d'action liée (`.bind`) : on identifie le formulaire
 * par la valeur de son argument lié (`$ACTION_n:1`), et non par la présence de
 * l'identifiant dans le bloc HTML — une case à cocher de la ligne suivante
 * pouvait se trouver dans le même bloc et décaler la sélection d'une ligne.
 */
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
      if (/^\$ACTION_\d+:\d+$/.test(name) && value.includes(id)) {
        bound = true;
      }
    }

    if (bound) return fields;
  }
  return null;
}

/** Texte débarrassé des marqueurs de commentaire insérés par React (<!-- -->). */
function text(html) {
  return html.replace(/<!-- -->/g, "");
}

/**
 * Soumet un formulaire comme le ferait un navigateur (multipart + bouton).
 *
 * `harvestJar` permet de lire le formulaire avec une autre session que celle
 * qui poste : c'est ainsi qu'on vérifie qu'un auteur banni est refusé même
 * lorsque le formulaire ne lui est plus affiché.
 */
async function submitForm(jar, urlPath, { contains, boundArg, button, fields: extraFields = {}, harvestJar }) {
  const page = await get(urlPath, { jar: harvestJar ?? jar });
  const fields = boundArg ? boundFormFields(page.body, boundArg) : formFields(page.body, contains);
  if (!fields) {
    return {
      ok: false,
      reason: `formulaire introuvable (${boundArg ?? [].concat(contains).join(" + ")})`,
    };
  }

  const boundary = `----WP10C${crypto.randomBytes(8).toString("hex")}`;
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

/**
 * Soumet la barre d'actions groupées avec une sélection : le navigateur
 * enverrait plusieurs valeurs pour `ids` (cases cochées) et l'intention du
 * bouton cliqué.
 */
async function bulkRequest(jar, urlPath, commentIds, intent) {
  const page = await get(urlPath, { jar });
  const fields = formFields(page.body, 'id="bulk-form"') ?? {};
  const boundary = `----WP10C${crypto.randomBytes(8).toString("hex")}`;
  const parts = Object.entries(fields).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
  );
  for (const id of commentIds) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ids"\r\n\r\n${id}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="intent"\r\n\r\n${intent}\r\n`));
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return request("POST", urlPath, {
    jar,
    raw: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
    headers: { origin: ORIGIN, referer: `${ORIGIN}${urlPath}` },
  });
}

/* ------------------------------------------------------------------ tests */

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

const statusOf = (id) => db.prepare("SELECT status FROM Comment WHERE id = ?").get(id)?.status;
const commentCount = () => db.prepare("SELECT COUNT(*) AS c FROM Comment").get().c;
const authorRow = (id) =>
  db.prepare("SELECT bannedUntil, banReason FROM Author WHERE id = ?").get(id);
const publicArticleId = () =>
  db.prepare("SELECT id FROM Article WHERE slug = ?").get(PUBLIC_ARTICLE_SLUG)?.id;

/**
 * Compte de test « journaliste », utilisé comme signalant par cette suite.
 * Renseigné dans `main` : le nettoyage en a besoin pour effacer les
 * notifications de signalement créées par le WP10d (voir plus bas).
 */
let reporterId = null;

function cleanup() {
  db.prepare("DELETE FROM Report WHERE id IN (?, ?)").run(...ids.reports);
  db.prepare("DELETE FROM Report WHERE commentId IN (SELECT id FROM Comment WHERE articleId = ?)").run(ids.article);
  db.prepare("DELETE FROM Comment WHERE articleId = ?").run(ids.article);
  db.prepare("DELETE FROM CommentReaction WHERE commentId IN (SELECT id FROM Comment WHERE content LIKE ?)").run(`${TAG}%`);
  db.prepare("DELETE FROM Comment WHERE content LIKE ?").run(`%${TAG}%`);
  db.prepare("DELETE FROM Article WHERE id = ?").run(ids.article);
  db.prepare("DELETE FROM Category WHERE id = ?").run(ids.category);
  db.prepare("UPDATE Author SET bannedUntil = NULL, banReason = NULL WHERE id = ?").run(ids.author);
  db.prepare("DELETE FROM Author WHERE id = ?").run(ids.author);
  if (reporterId) {
    // Depuis le WP10d, traiter un signalement notifie son auteur : ces
    // notifications de test ne doivent pas s'accumuler sur le compte de test.
    // `Notification` n'existe qu'à partir du WP10d : la suite reste exécutable
    // sur une base antérieure.
    try {
      db.prepare(
        "DELETE FROM Notification WHERE userId = ? AND type IN ('REPORT_RESOLVED', 'REPORT_DISMISSED')",
      ).run(reporterId);
    } catch {
      /* table absente : base antérieure au WP10d */
    }
  }
}

async function main() {
  cleanup();

  /* ------------------------------------------------------- 1) Schéma et base */
  console.log("--- Schéma et migration ---");
  const authorBlock = schema.slice(schema.indexOf("model Author {"), schema.indexOf("enum UserRole"));
  check("Author : champ bannedUntil", /bannedUntil\s+DateTime\?/.test(authorBlock));
  check("Author : champ banReason", /banReason\s+String\?/.test(authorBlock));

  const columns = db
    .prepare("PRAGMA table_info(Author)")
    .all()
    .map((column) => column.name);
  check(
    "colonnes créées en base",
    columns.includes("bannedUntil") && columns.includes("banReason"),
    `bannedUntil=${columns.includes("bannedUntil")} banReason=${columns.includes("banReason")}`,
  );
  const applied = db
    .prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '%init_postgres%' AND finished_at IS NOT NULL",
    )
    .get();
  // WP12a : migration unique `init_postgres` côté PostgreSQL (ex-add_user_ban_fields).
  check("migration init_postgres (schéma PostgreSQL) appliquée", Boolean(applied), applied?.migration_name);
  check(
    "aucun modèle hors périmètre ajouté par le WP10c",
    // Le WP10c n'ajoute que les colonnes de bannissement. `Notification` est
    // arrivé plus tard, avec le WP10d (vérifié par scripts/check-wp10d.cjs).
    !/model (AuditLog|BlockedKeyword) /.test(schema),
  );

  /* ----------------------------------------------------------- 2) Helpers */
  console.log("\n--- Helpers de modération ---");
  check("COMMENT_EXCERPT_LENGTH = 150", /COMMENT_EXCERPT_LENGTH = 150/.test(engagement));
  check(
    "quatre durées de bannissement (1 / 7 / 30 jours, permanent)",
    ["1d", "7d", "30d", "permanent"].every((value) => engagement.includes(`value: "${value}"`)),
  );
  check("date de fin permanente déclarée", /PERMANENT_BAN_UNTIL/.test(engagement));
  check(
    "aides : isBanned / banStatusLabel / bannedCommentMessage",
    ["export function isBanned", "export function banStatusLabel", "export function bannedCommentMessage"].every(
      (needle) => engagement.includes(needle),
    ),
  );
  check(
    "message de bannissement conforme au brief",
    /Vous êtes temporairement banni jusqu'au/.test(engagement) && /Raison : /.test(engagement),
  );

  /* ---------------------------------------------- 3) Server Actions (source) */
  console.log("\n--- Server Actions ---");
  check('module « use server »', actionsSource.startsWith('"use server";'));
  const expected = [
    "approveComment",
    "rejectComment",
    "deleteComment",
    "resolveReport",
    "dismissReport",
    "banUser",
    "unbanUser",
    "bulkApprove",
    "bulkReject",
    "bulkDelete",
  ];
  for (const name of expected) {
    check(`export ${name}`, new RegExp(`export async function ${name}\\(`).test(actionsSource));
  }
  check(
    "garde ADMIN sur toutes les actions",
    /async function requireAdmin/.test(actionsSource) &&
      /redirect\("\/studio"\)/.test(actionsSource) &&
      /redirect\("\/login"\)/.test(actionsSource),
  );
  check(
    "résolution : signalement RESOLVED + commentaire REJECTED dans une transaction",
    /prisma\.\$transaction/.test(actionsSource) &&
      /status: "RESOLVED"/.test(actionsSource) &&
      /status: "REJECTED"/.test(actionsSource) &&
      /resolvedById: admin\.id/.test(actionsSource),
  );
  check("rejet du signalement : DISMISSED", /status: "DISMISSED"/.test(actionsSource));
  check(
    "bannissement : durée et motif depuis le formulaire",
    /banUntilFromDuration\(label\)/.test(actionsSource) && /banReason/.test(actionsSource),
  );
  check(
    "débannissement : les deux champs sont effacés",
    /bannedUntil: null, banReason: null/.test(actionsSource),
  );

  /* ------------------------------------------------- 4) Données de test */
  const adminJar = await login("admin@example.com", "admin123");
  check("session ADMIN ouverte", adminJar.has("authjs.session-token"));

  const authorId = ids.author;
  const passwordHash = bcrypt.hashSync("password123", 10);
  db.prepare(
    `INSERT INTO Author (id, name, email, passwordHash, role, isPremium, slug, createdAt)
     VALUES (?, ?, ?, ?, 'JOURNALIST', 0, ?, ?)`,
  ).run(authorId, `Testeur ${TAG}`, `${TAG}@example.test`, passwordHash, TAG, new Date().toISOString());
  const peer = db.prepare("SELECT id FROM Author WHERE email = ?").get("journalist@example.com");
  reporterId = peer.id;
  check("auteur de test et pair disponibles", Boolean(peer?.id));

  db.prepare(`INSERT INTO Category (id, name, slug, createdAt) VALUES (?, ?, ?, ?)`).run(
    ids.category,
    `Catégorie ${TAG}`,
    ids.category,
    new Date().toISOString(),
  );
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO Article (id, title, slug, content, status, isPremium, authorId, categoryId, createdAt, updatedAt)
     VALUES (?, ?, ?, 'Contenu de test.', 'DRAFT', 0, ?, ?, ?, ?)`,
  ).run(ids.article, `Article ${TAG}`, ids.article, authorId, ids.category, now, now);

  const insertComment = db.prepare(
    `INSERT INTO Comment (id, content, articleId, authorId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // Les trois commentaires des actions individuelles reçoivent les dates les
  // plus récentes : la liste est triée du plus récent au plus ancien et
  // paginée par 50, ils doivent donc se trouver en première page.
  ids.comments.forEach((id, index) => {
    const createdAt = new Date(Date.now() + (10 + index) * 1000).toISOString();
    insertComment.run(
      id,
      `${MARKER} commentaire ${index + 1} : texte assez long pour être tronqué proprement dans le tableau de modération.`,
      ids.article,
      index === 2 ? peer.id : authorId,
      "PENDING",
      createdAt,
      createdAt,
    );
  });
  ids.bulk.forEach((id, index) => {
    insertComment.run(id, `${MARKER} lot ${index + 1}`, ids.article, authorId, "PENDING", now, now);
  });
  ids.pagination.forEach((id) => {
    insertComment.run(id, `${MARKER} pagination`, ids.article, authorId, "PENDING", now, now);
  });

  insertComment.run(`${TAG}-pub`, `${MARKER} commentaire public`, publicArticleId(), peer.id, "APPROVED", now, now);
  insertComment.run(`${TAG}-attente`, `${MARKER} commentaire en attente`, publicArticleId(), peer.id, "PENDING", now, now);

  db.prepare(
    `INSERT INTO Report (id, commentId, reporterId, reason, details, status, createdAt)
     VALUES (?, ?, ?, 'SPAM', 'Signalement de test', 'PENDING', ?)`,
  ).run(ids.reports[0], ids.comments[0], peer.id, now);
  db.prepare(
    `INSERT INTO Report (id, commentId, reporterId, reason, status, createdAt)
     VALUES (?, ?, ?, 'HARASSMENT', 'PENDING', ?)`,
  ).run(ids.reports[1], ids.comments[1], peer.id, now);

  check("jeu de test inséré", commentCount() >= 60, `${commentCount()} commentaires en base`);

  /* ------------------------------------------------------- 5) Accès à la page */
  console.log("\n--- /backoffice/comments ---");
  const anon = await get("/backoffice/comments");
  check("visiteur : redirection vers /login", anon.status === 307 && anon.location === "/login", `${anon.status} ${anon.location}`);

  const journalistJar = await login("journalist@example.com", "password123");
  const journalist = await get("/backoffice/comments", { jar: journalistJar });
  check("JOURNALIST : redirection vers /studio", journalist.status === 307 && journalist.location === "/studio", `${journalist.status} ${journalist.location}`);

  const page = await get("/backoffice/comments", { jar: adminJar });
  check("ADMIN : page accessible", page.status === 200, `status=${page.status}`);
  check(
    "trois onglets",
    ["tab=comments", "tab=reports", "tab=users"].every((link) => page.body.includes(link)) &&
      ["Commentaires", "Signalements", "Utilisateurs"].every((label) => page.body.includes(label)),
  );
  check(
    "statistiques affichées",
    ["Commentaires en attente", "Signalements ouverts", "Utilisateurs bannis", "Commentaires aujourd'hui"].every(
      (label) => page.body.includes(label),
    ),
  );
  check(
    "filtres du brief (statut, article, auteur)",
    page.body.includes('name="status"') && page.body.includes('name="article"') && page.body.includes('name="author"'),
  );
  check(
    "barre d'actions groupées",
    ["Approuver la sélection", "Rejeter la sélection", "Supprimer la sélection"].every((label) =>
      page.body.includes(label),
    ),
  );
  const pageText = text(page.body);
  check(
    "cases de sélection rattachées au formulaire groupé",
    (page.body.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []).some(
      (tag) => tag.includes('name="ids"') && tag.includes('form="bulk-form"'),
    ),
  );
  check(
    "actions individuelles",
    ["Approuver", "Rejeter", "Supprimer", "Voir l&#x27;article"].every((label) => pageText.includes(label)),
  );
  // Hydratation : React n'insère aucun blanc entre les balises d'un tableau.
  // Un blanc entre deux cellules dans le HTML servi est donc un nœud de texte
  // parasite, interdit dans <tr> — c'est exactement l'erreur
  // « whitespace text nodes cannot be a child of <tr> » corrigée après le WP10c.
  const strayWhitespace = [
    ...page.body.matchAll(/<\/t[dh]>[ \t]+<t[dh]/g),
    ...page.body.matchAll(/<tr[^>]*>[ \t]+<t[dh]/g),
    ...page.body.matchAll(/<\/tr>[ \t]+<tr/g),
  ].map((match) => match[0].slice(0, 60));
  check(
    "aucun nœud de texte parasite entre les cellules (hydratation)",
    strayWhitespace.length === 0,
    strayWhitespace.join(" | ") || "aucun",
  );
  // Les signalements d'un commentaire sont détaillés dans l'onglet Commentaires :
  // motif, auteur du signalement, date et précisions éventuelles.
  check(
    "signalement détaillé dans l'onglet Commentaires (motif, auteur, date)",
    pageText.includes("Spam") &&
      pageText.includes("journalist@example.com") &&
      /signalé le/.test(pageText),
  );
  check(
    "signalement : précisions affichées dans l'onglet Commentaires",
    pageText.includes("Signalement de test"),
  );
  check("pagination annoncée (50 par page)", /page 1 \/ \d+/.test(pageText), pageText.match(/page \d+ \/ \d+/)?.[0]);
  const firstPageCheckboxes = (page.body.match(/name="ids"/g) ?? []).length;
  check("50 lignes maximum par page", firstPageCheckboxes === 50, `${firstPageCheckboxes} cases`);

  const page2 = await get("/backoffice/comments?tab=comments&page=2", { jar: adminJar });
  const secondPageCheckboxes = (page2.body.match(/name="ids"/g) ?? []).length;
  check(
    "page 2 : lignes restantes",
    page2.status === 200 && secondPageCheckboxes > 0 && secondPageCheckboxes < 50,
    `${secondPageCheckboxes} cases`,
  );

  const filtered = await get("/backoffice/comments?tab=comments&status=PENDING", { jar: adminJar });
  check(
    "filtre statut : aucun commentaire approuvé dans le tableau",
    filtered.status === 200 && !/data-badge-variant="status">Approuvé/.test(filtered.body),
    `badges « Approuvé » : ${(filtered.body.match(/data-badge-variant="status">Approuvé/g) ?? []).length}`,
  );
  const byAuthor = await get(`/backoffice/comments?tab=comments&author=${encodeURIComponent(TAG)}`, { jar: adminJar });
  // Le filtre auteur doit restreindre aux commentaires de cet auteur : on
  // vérifie sur le contenu des commentaires, car les noms et e-mails d'autres
  // personnes peuvent légitimement apparaître (auteurs de signalements).
  check(
    "filtre auteur : seuls ses commentaires",
    byAuthor.body.includes(`${MARKER} commentaire 1`) && !byAuthor.body.includes(`${MARKER} commentaire 3`),
  );
  const byArticle = await get(`/backoffice/comments?tab=comments&article=${ids.article}`, { jar: adminJar });
  check("filtre article", byArticle.body.includes(`Article ${TAG}`) && firstPageCheckboxes > 0);

  const reportsPage = await get("/backoffice/comments?tab=reports", { jar: adminJar });
  check("onglet signalements accessible", reportsPage.status === 200, `status=${reportsPage.status}`);
  check(
    "signalements : colonnes et actions",
    reportsPage.body.includes("Spam") &&
      ["Résoudre", "Rejeter le signalement", "Supprimer le commentaire"].every((label) =>
        reportsPage.body.includes(label),
      ),
  );
  const reportsFiltered = await get("/backoffice/comments?tab=reports&status=DISMISSED", { jar: adminJar });
  check(
    "filtre statut des signalements",
    reportsFiltered.status === 200 && !/data-badge-variant="status">À traiter/.test(reportsFiltered.body),
  );

  const usersPage = await get("/backoffice/comments?tab=users", { jar: adminJar });
  check("onglet utilisateurs accessible", usersPage.status === 200, `status=${usersPage.status}`);
  check(
    "utilisateurs : colonnes du brief",
    ["Commentaires", "Rejetés", "Signalés", "Bannissement"].every((label) => usersPage.body.includes(label)),
  );
  check("action Bannir présente", usersPage.body.includes(">Bannir<"));
  check(
    "formulaire modal de bannissement (durée + raison)",
    (await get(`/backoffice/comments?tab=users&bannir=${ids.author}`, { jar: adminJar })).body.includes(
      'name="duration"',
    ),
  );

  /* ---------------------------------------------------- 6) Actions individuelles */
  console.log("\n--- Actions de modération ---");
  // Les formulaires de ligne sont des actions liées : on les identifie par
  // l'argument lié (l'identifiant du commentaire).
  const rowPath = `/backoffice/comments?tab=comments&article=${ids.article}`;

  const approve = await submitForm(adminJar, rowPath, {
    boundArg: ids.comments[0],
    button: { name: "intent", value: "approve" },
  });
  check(
    "Approuver : statut APPROVED",
    approve.ok && statusOf(ids.comments[0]) === "APPROVED",
    approve.ok ? String(statusOf(ids.comments[0])) : approve.reason,
  );

  const reject = await submitForm(adminJar, rowPath, {
    boundArg: ids.comments[1],
    button: { name: "intent", value: "reject" },
  });
  check(
    "Rejeter : statut REJECTED",
    reject.ok && statusOf(ids.comments[1]) === "REJECTED",
    reject.ok ? String(statusOf(ids.comments[1])) : reject.reason,
  );

  const remove = await submitForm(adminJar, rowPath, {
    boundArg: ids.comments[2],
    button: { name: "intent", value: "delete" },
  });
  check(
    "Supprimer : statut DELETED",
    remove.ok && statusOf(ids.comments[2]) === "DELETED",
    remove.ok ? String(statusOf(ids.comments[2])) : remove.reason,
  );

  /* ------------------------------------------------------- 7) Actions groupées */
  const bulkPath = `/backoffice/comments?tab=comments&article=${ids.article}`;

  const bulkApprove = await bulkRequest(adminJar, bulkPath, ids.bulk, "approve");
  check(
    "action groupée : approuver la sélection",
    bulkApprove.status < 400 && ids.bulk.every((id) => statusOf(id) === "APPROVED"),
    ids.bulk.map((id) => statusOf(id)).join(", "),
  );

  const bulkReject = await bulkRequest(adminJar, bulkPath, ids.bulk, "reject");
  check(
    "action groupée : rejeter la sélection",
    bulkReject.status < 400 && ids.bulk.every((id) => statusOf(id) === "REJECTED"),
    ids.bulk.map((id) => statusOf(id)).join(", "),
  );

  const bulkDelete = await bulkRequest(adminJar, bulkPath, ids.bulk, "delete");
  check(
    "action groupée : supprimer la sélection",
    bulkDelete.status < 400 && ids.bulk.every((id) => statusOf(id) === "DELETED"),
    ids.bulk.map((id) => statusOf(id)).join(", "),
  );

  /* --------------------------------------------------------- 8) Signalements */
  const resolved = await submitForm(adminJar, "/backoffice/comments?tab=reports", {
    contains: ids.reports[0],
    button: { name: "intent", value: "resolve" },
  });
  const report0 = db.prepare("SELECT status, resolvedAt, resolvedById FROM Report WHERE id = ?").get(ids.reports[0]);
  check(
    "Résoudre : signalement RESOLVED + commentaire REJECTED + modérateur noté",
    resolved.ok &&
      report0?.status === "RESOLVED" &&
      Boolean(report0?.resolvedAt) &&
      Boolean(report0?.resolvedById) &&
      statusOf(ids.comments[0]) === "REJECTED",
    `${report0?.status} / commentaire ${statusOf(ids.comments[0])}`,
  );

  const beforeDismiss = statusOf(ids.comments[1]);
  const dismissed = await submitForm(adminJar, "/backoffice/comments?tab=reports", {
    contains: ids.reports[1],
    button: { name: "intent", value: "dismiss" },
  });
  const report1 = db.prepare("SELECT status FROM Report WHERE id = ?").get(ids.reports[1]);
  check(
    "Rejeter le signalement : DISMISSED et commentaire inchangé",
    dismissed.ok && report1?.status === "DISMISSED" && statusOf(ids.comments[1]) === beforeDismiss,
    `${report1?.status} / commentaire ${statusOf(ids.comments[1])}`,
  );

  const report2 = `${TAG}-rpt-3`;
  db.prepare(
    `INSERT INTO Report (id, commentId, reporterId, reason, status, createdAt)
     VALUES (?, ?, ?, 'OTHER', 'PENDING', ?)`,
  ).run(report2, ids.comments[2], peer.id, now);
  const deletedViaReport = await submitForm(adminJar, "/backoffice/comments?tab=reports", {
    contains: report2,
    button: { name: "intent", value: "delete" },
  });
  check(
    "Supprimer le commentaire depuis un signalement",
    deletedViaReport.ok && statusOf(ids.comments[2]) === "DELETED",
    statusOf(ids.comments[2]),
  );

  /* ------------------------------------------------------- 9) Bannissement */
  const banForm = await submitForm(adminJar, `/backoffice/comments?tab=users&bannir=${ids.author}`, {
    contains: 'name="duration"',
    fields: { duration: "1d", reason: "Propos répétés hors charte" },
  });
  const banned = authorRow(ids.author);
  const untilDate = banned?.bannedUntil ? new Date(banned.bannedUntil) : null;
  const oneDayAhead = Date.now() + 23 * 60 * 60 * 1000;
  check(
    "Bannir : bannedUntil (~1 jour) et banReason renseignés",
    banForm.ok &&
      Boolean(untilDate) &&
      untilDate.getTime() > oneDayAhead &&
      banned?.banReason === "Propos répétés hors charte",
    `${banned?.bannedUntil ?? "aucune date"} / ${banned?.banReason ?? "aucune raison"}`,
  );

  const bannedUserJar = await login(`${TAG}@example.test`, "password123");
  check("session de l'utilisateur banni ouverte", bannedUserJar.has("authjs.session-token"));

  const publicPath = `/article/${PUBLIC_ARTICLE_SLUG}`;
  const bannedView = await get(publicPath, { jar: bannedUserJar });
  check(
    "message de bannissement affiché sur l'article",
    bannedView.body.includes("Vous êtes temporairement banni jusqu&#x27;au") &&
      bannedView.body.includes("Propos répétés hors charte"),
  );
  check(
    "formulaire de commentaire remplacé par le message",
    !bannedView.body.includes('id="champ-commentaire"'),
  );

  const beforeBannedAttempt = commentCount();
  const bannedAttempt = await submitForm(
    bannedUserJar,
    publicPath,
    {
      contains: 'name="slug"',
      fields: { content: `${MARKER} tentative d'un utilisateur banni` },
      // Le formulaire n'est plus rendu pour cet utilisateur : on récupère les
      // champs avec une session valide, mais on poste avec la sienne.
      harvestJar: adminJar,
    },
  );
  check(
    "createComment refuse un auteur banni",
    bannedAttempt.ok &&
      commentCount() === beforeBannedAttempt &&
      String(bannedAttempt.location ?? "").includes("commentaire=banni"),
    `commentaires ${beforeBannedAttempt} → ${commentCount()}, redirection ${bannedAttempt.location ?? bannedAttempt.reason ?? "—"}`,
  );

  // « Débannir » : le formulaire de la ligne de l'auteur (bouton nommé).
  const unban = await submitForm(adminJar, "/backoffice/comments?tab=users", {
    contains: ">Débannir<",
  });
  const unbanned = authorRow(ids.author);
  check(
    "Débannir : les deux champs sont effacés",
    unban.ok && unbanned?.bannedUntil === null && unbanned?.banReason === null,
    `bannedUntil=${unbanned?.bannedUntil ?? "null"} banReason=${unbanned?.banReason ?? "null"}`,
  );
  check(
    "l'utilisateur débanni retrouve le formulaire",
    (await get(publicPath, { jar: bannedUserJar })).body.includes('id="champ-commentaire"'),
  );

  /* -------------------------------------------------------- 10) Commentaire public */
  console.log("\n--- Interface publique ---");
  const anonArticle = await get(publicPath);
  check(
    "visiteur : invitation à se connecter",
    anonArticle.body.includes("Connectez-vous") && !anonArticle.body.includes('id="champ-commentaire"'),
  );
  check(
    "seuls les commentaires approuvés sont visibles",
    anonArticle.body.includes(`${MARKER} commentaire public`) &&
      !anonArticle.body.includes(`${MARKER} commentaire en attente`),
  );

  const comment = await submitForm(bannedUserJar, publicPath, {
    contains: 'name="slug"',
    button: { name: "submit", value: "1" },
    fields: { content: `${MARKER} commentaire déposé par l'API` },
  });
  const created = db
    .prepare("SELECT id, status FROM Comment WHERE content LIKE ? ORDER BY createdAt DESC LIMIT 1")
    .get(`%commentaire déposé par l'API%`);
  check(
    "dépôt d'un commentaire : créé en attente et invisible publiquement",
    comment.ok &&
      created?.status === "PENDING" &&
      !(await get(publicPath)).body.includes("commentaire déposé par l'API"),
    `statut=${created?.status ?? "aucun"}`,
  );

  const approveOwn = await submitForm(
    adminJar,
    `/backoffice/comments?tab=comments&article=${encodeURIComponent(publicArticleSlug())}`,
    {
      boundArg: created?.id ?? "",
      button: { name: "intent", value: "approve" },
    },
  );
  check(
    "un commentaire approuvé devient visible publiquement",
    approveOwn.ok && (await get(publicPath)).body.includes("commentaire déposé par l'API"),
    approveOwn.ok ? "visible" : approveOwn.reason,
  );

  const emptyAttempt = await submitForm(bannedUserJar, publicPath, {
    contains: 'name="slug"',
    button: { name: "submit", value: "1" },
    fields: { content: "   " },
  });
  check(
    "commentaire vide refusé",
    emptyAttempt.ok && String(emptyAttempt.location ?? "").includes("commentaire=vide"),
    String(emptyAttempt.location ?? ""),
  );

  const longAttempt = await submitForm(bannedUserJar, publicPath, {
    contains: 'name="slug"',
    button: { name: "submit", value: "1" },
    fields: { content: "x".repeat(5001) },
  });
  check(
    "commentaire trop long refusé (5000 caractères maximum)",
    longAttempt.ok && String(longAttempt.location ?? "").includes("commentaire=long"),
    String(longAttempt.location ?? ""),
  );

  /* ------------------------------------------------------- 11) Périmètre */
  console.log("\n--- Périmètre ---");
  const newFiles = [
    "src/app/backoffice/comments/actions.ts",
    "src/app/backoffice/comments/components/CommentsTab.tsx",
    "src/app/backoffice/comments/components/ReportsTab.tsx",
    "src/app/backoffice/comments/components/UsersTab.tsx",
    "src/app/backoffice/comments/components/BanModal.tsx",
    "src/app/backoffice/comments/components/ModerationBadges.tsx",
  ];
  check(
    "aucun composant client ajouté (modération sans JavaScript)",
    newFiles.every((file) => !readFileSync(path.join(ROOT, file), "utf8").includes('"use client"')),
  );
  check(
    "aucun journal d'audit (le WP10c ne consigne pas les décisions)",
    // Les notifications de modération relèvent du WP10d : elles sont vérifiées
    // par scripts/check-wp10d.cjs, pas ici.
    !/(auditLog|AuditLog|journaliser)/i.test(
      readFileSync(path.join(ROOT, "src/app/backoffice/comments/actions.ts"), "utf8"),
    ) && !/model AuditLog /.test(schema),
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
