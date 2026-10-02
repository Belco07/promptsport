/**
 * Vérification des droits éditoriaux sur les articles (WP11).
 * Exécution : PORT=3002 node scripts/check-workflow-roles.cjs
 *
 * Modèle vérifié :
 *  - toute la rédaction voit tous les articles ;
 *  - un JOURNALIST n'agit que sur ses propres articles non publiés
 *    (brouillon ↔ en revue), jamais sur ceux d'un collègue ;
 *  - une fois publié, l'article sort du périmètre de son auteur : plus de
 *    changement de statut, plus d'édition, plus de suppression ;
 *  - seuls ADMIN et EDITOR publient, archivent ou dépublient ;
 *  - le passage en brouillon est réservé à l'auteur de l'article ;
 *  - supprimer un article publié ou archivé est réservé à l'ADMIN.
 *
 * Les règles sont vérifiées côté serveur (appel direct des Server Actions) et
 * dans l'interface (actions proposées selon le rôle), puis les données de test
 * sont supprimées.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync, existsSync } = require("node:fs");
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

const TAG = `chk11-${crypto.randomBytes(4).toString("hex")}`;
const slugs = {
  aDraft: `${TAG}-a-draft`,
  aReview: `${TAG}-a-review`,
  aPublished: `${TAG}-a-published`,
  bDraft: `${TAG}-b-draft`,
  bPublished: `${TAG}-b-published`,
  eReview: `${TAG}-e-review`,
};

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
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/studio/articles` },
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

/** Identifiant d'une action exportée, lu dans le manifeste de la page. */
function actionId(exportedName, page = ".next/server/app/studio/articles/page/server-reference-manifest.json") {
  const file = path.join(ROOT, page);
  if (!existsSync(file)) return null;
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    if (entry?.exportedName === exportedName) return id;
  }
  return null;
}

/** Champs cachés d'un formulaire (plomberie des Server Actions incluse). */
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
    fields[name] = (tag.match(/value="([^"]*)"/)?.[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  }
  return fields;
}

/** Soumission multipart (comme un navigateur sans JavaScript). */
async function submitForm(jar, urlPath, { contains, fields: extraFields = {} }, harvestJar) {
  const page = await get(urlPath, { jar: harvestJar ?? jar });
  const fields = formFields(page.body, contains);
  if (!fields) {
    return { ok: false, reason: "formulaire introuvable" };
  }

  const boundary = `----WP11${crypto.randomBytes(8).toString("hex")}`;
  const parts = Object.entries({ ...fields, ...extraFields }).map(([name, value]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
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

/* --------------------------------------------------------------- données */

const articleId = (slug) => db.prepare("SELECT id FROM Article WHERE slug = ?").get(slug)?.id;
const statusOf = (slug) => db.prepare("SELECT status FROM Article WHERE slug = ?").get(slug)?.status;
const titleOf = (slug) => db.prepare("SELECT title FROM Article WHERE slug = ?").get(slug)?.title;
const exists = (slug) => Boolean(db.prepare("SELECT 1 FROM Article WHERE slug = ?").get(slug));

let categoryId = null;
let authorA = null;
let authorB = null;
let editor = null;

function cleanup() {
  // Certains articles sont créés par la Server Action, qui génère le slug à
  // partir du titre : le nettoyage doit donc aussi porter sur le titre.
  db.prepare("DELETE FROM Article WHERE slug LIKE ?").run(`${TAG}%`);
  db.prepare("DELETE FROM Article WHERE title LIKE ?").run(`%${TAG}%`);
  db.prepare("DELETE FROM Author WHERE id = ?").run(authorB ?? "");
}

function results() {
  return checks;
}

const checks = [];
function check(label, ok, detail) {
  checks.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  cleanup();

  const admin = db.prepare("SELECT id FROM Author WHERE email = 'admin@example.com'").get();
  authorA = db.prepare("SELECT id FROM Author WHERE email = 'journalist@example.com'").get();
  editor = db.prepare("SELECT id FROM Author WHERE email = 'editor@example.com'").get();
  categoryId = db.prepare("SELECT id FROM Category LIMIT 1").get()?.id;
  check(
    "comptes de test disponibles (admin, journaliste, éditeur, catégorie)",
    Boolean(admin?.id && authorA?.id && editor?.id && categoryId),
  );

  authorB = `${TAG}-author`;
  db.prepare(
    `INSERT INTO Author (id, name, email, passwordHash, role, isPremium, slug, createdAt)
     VALUES (?, ?, ?, ?, 'JOURNALIST', 0, ?, ?)`,
  ).run(
    authorB,
    `Journaliste B ${TAG}`,
    `${authorB}@example.test`,
    bcrypt.hashSync("password123", 10),
    authorB,
    new Date().toISOString(),
  );

  const now = new Date().toISOString();
  const insertArticle = db.prepare(
    `INSERT INTO Article (id, title, slug, content, status, publishedAt, isPremium, authorId, categoryId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
  );
  const addArticle = (slug, title, authorId, status) =>
    insertArticle.run(
      `${TAG}-${slug}`,
      title,
      slug,
      "Contenu initial.",
      status,
      status === "PUBLISHED" ? now : null,
      authorId,
      categoryId,
      now,
      now,
    );

  addArticle(slugs.aDraft, `A brouillon ${TAG}`, authorA.id, "DRAFT");
  addArticle(slugs.aReview, `A en revue ${TAG}`, authorA.id, "REVIEW");
  addArticle(slugs.aPublished, `A publié ${TAG}`, authorA.id, "PUBLISHED");
  addArticle(slugs.bDraft, `B brouillon ${TAG}`, authorB, "DRAFT");
  addArticle(slugs.bPublished, `B publié ${TAG}`, authorB, "PUBLISHED");
  addArticle(slugs.eReview, `Éditeur en revue ${TAG}`, editor.id, "REVIEW");
  check("six articles de test créés", db.prepare("SELECT COUNT(*) AS c FROM Article WHERE slug LIKE ?").get(`${TAG}%`).c === 6);

  const adminJar = await login("admin@example.com", "admin123");
  const authorJar = await login("journalist@example.com", "password123");
  const otherJar = await login(`${authorB}@example.test`, "password123");
  const editorJar = await login("editor@example.com", "password123");
  check(
    "sessions ouvertes (admin, auteur, autre journaliste, éditeur)",
    adminJar.has("authjs.session-token") &&
      authorJar.has("authjs.session-token") &&
      otherJar.has("authjs.session-token") &&
      editorJar.has("authjs.session-token"),
  );

  const statusActionId = actionId("updateArticleStatus");
  check("identifiant de l'action de changement de statut trouvé", Boolean(statusActionId), statusActionId?.slice(0, 8));

  /* ------------------------------------------- 1) Transitions par rôle */
  console.log("\n--- Transitions de statut (côté serveur) ---");

  const tryStatus = async (jar, slug, to) =>
    callAction(jar, "/studio/articles", statusActionId, [articleId(slug), to]);

  const ownDraftToReview = await tryStatus(authorJar, slugs.aDraft, "REVIEW");
  check(
    "auteur : brouillon → en revue autorisé",
    ownDraftToReview.status < 400 && statusOf(slugs.aDraft) === "REVIEW",
    String(statusOf(slugs.aDraft)),
  );

  await tryStatus(authorJar, slugs.aReview, "DRAFT");
  check("auteur : en revue → brouillon autorisé", statusOf(slugs.aReview) === "DRAFT", String(statusOf(slugs.aReview)));

  await tryStatus(authorJar, slugs.aReview, "PUBLISHED");
  check("auteur : publication refusée", statusOf(slugs.aReview) === "DRAFT", String(statusOf(slugs.aReview)));

  await tryStatus(authorJar, slugs.aReview, "ARCHIVED");
  check("auteur : archivage refusé", statusOf(slugs.aReview) === "DRAFT", String(statusOf(slugs.aReview)));

  await tryStatus(authorJar, slugs.bDraft, "REVIEW");
  check(
    "journaliste : article d'un collègue non modifiable",
    statusOf(slugs.bDraft) === "DRAFT",
    String(statusOf(slugs.bDraft)),
  );

  await tryStatus(authorJar, slugs.aPublished, "REVIEW");
  check(
    "auteur : article publié, plus aucun changement de statut",
    statusOf(slugs.aPublished) === "PUBLISHED",
    String(statusOf(slugs.aPublished)),
  );

  await tryStatus(otherJar, slugs.bPublished, "DRAFT");
  check(
    "auteur d'un article publié : retour au brouillon refusé",
    statusOf(slugs.bPublished) === "PUBLISHED",
    String(statusOf(slugs.bPublished)),
  );

  await tryStatus(editorJar, slugs.aReview, "PUBLISHED");
  check("éditeur : publication autorisée", statusOf(slugs.aReview) === "PUBLISHED", String(statusOf(slugs.aReview)));

  await tryStatus(editorJar, slugs.aReview, "REVIEW");
  check("éditeur : dépublication vers « en revue »", statusOf(slugs.aReview) === "REVIEW", String(statusOf(slugs.aReview)));

  await tryStatus(editorJar, slugs.aReview, "ARCHIVED");
  check("éditeur : archivage autorisé", statusOf(slugs.aReview) === "ARCHIVED", String(statusOf(slugs.aReview)));

  await tryStatus(editorJar, slugs.aReview, "DRAFT");
  check(
    "éditeur : brouillon refusé sur l'article d'un auteur (réservé à l'auteur)",
    statusOf(slugs.aReview) === "ARCHIVED",
    String(statusOf(slugs.aReview)),
  );

  await tryStatus(editorJar, slugs.eReview, "DRAFT");
  check(
    "éditeur : brouillon autorisé sur son propre article",
    statusOf(slugs.eReview) === "DRAFT",
    String(statusOf(slugs.eReview)),
  );

  await tryStatus(adminJar, slugs.bDraft, "PUBLISHED");
  check("admin : publication autorisée", statusOf(slugs.bDraft) === "PUBLISHED", String(statusOf(slugs.bDraft)));

  /* ------------------------------------------------- 2) Édition du contenu */
  console.log("\n--- Édition du contenu ---");

  /**
   * Édition du contenu. Le formulaire est récupéré avec la session de
   * l'éditeur (`harvestJar`) : quand l'utilisateur cible n'a pas le droit
   * d'éditer, la page ne rend pas de formulaire — or on veut justement vérifier
   * que la Server Action refuse, même appelée directement.
   *
   * `isPremium` n'est transmis que s'il est demandé : la case n'est pas un champ
   * caché, donc absente du formulaire récolté — c'est exactement ce que fait un
   * navigateur lorsque la case est décochée.
   */
  const edit = (jar, slug, { title, status, isPremium: premium }, harvestJar = editorJar) =>
    submitForm(
      jar,
      `/studio/articles/${articleId(slug)}/edit`,
      {
        contains: 'name="title"',
        fields: {
          title,
          content: "Contenu modifié.",
          slug,
          excerpt: "",
          coverImageUrl: "",
          categoryId,
          status,
          ...(premium ? { isPremium: premium } : {}),
        },
      },
      harvestJar,
    );

  const ownEdit = await edit(authorJar, slugs.aDraft, { title: `Modifié par A ${TAG}`, status: "REVIEW" });
  check(
    "auteur : modification de son brouillon autorisée",
    ownEdit.ok && titleOf(slugs.aDraft) === `Modifié par A ${TAG}` && statusOf(slugs.aDraft) === "REVIEW",
    `${titleOf(slugs.aDraft)} / ${statusOf(slugs.aDraft)}`,
  );

  const otherEdit = await edit(authorJar, slugs.bDraft, { title: `Modifié par A (autre) ${TAG}`, status: "PUBLISHED" });
  check(
    "journaliste : modification de l'article d'un collègue refusée",
    otherEdit.ok && titleOf(slugs.bDraft) === `B brouillon ${TAG}`,
    String(titleOf(slugs.bDraft)),
  );

  const publishedEdit = await edit(authorJar, slugs.aPublished, { title: `Modifié par A (publié) ${TAG}`, status: "PUBLISHED" });
  check(
    "auteur : modification de son article publié refusée",
    publishedEdit.ok && titleOf(slugs.aPublished) === `A publié ${TAG}`,
    String(titleOf(slugs.aPublished)),
  );

  const publishByEdit = await edit(authorJar, slugs.aDraft, { title: `Tentative de publication ${TAG}`, status: "PUBLISHED" });
  check(
    "journaliste : publication détournée par le formulaire d'édition refusée",
    publishByEdit.ok && statusOf(slugs.aDraft) === "REVIEW" && titleOf(slugs.aDraft) !== `Tentative de publication ${TAG}`,
    `${statusOf(slugs.aDraft)} / ${titleOf(slugs.aDraft)}`,
  );

  const editorEdit = await edit(editorJar, slugs.aPublished, { title: `Corrigé par l'éditeur ${TAG}`, status: "PUBLISHED" });
  check(
    "éditeur : modification d'un article publié autorisée",
    editorEdit.ok && titleOf(slugs.aPublished) === `Corrigé par l'éditeur ${TAG}`,
    String(titleOf(slugs.aPublished)),
  );

  // L'accueil est prérendu (`revalidate = 60`), le sitemap avec 1 h et le RSS
  // avec 15 min : modifier un article publié doit invalider ces trois pages tout
  // de suite. En développement la page est rendue à chaque requête, donc le
  // contrôle ne prouve rien ; en production (npm run start), il échoue si
  // l'invalidation manque.
  const actionsSource = readFileSync(path.join(ROOT, "src/app/studio/articles/actions.ts"), "utf8");
  check(
    "actions d'articles : les surfaces publiques prérendues sont invalidées",
    /function revalidatePublicSurfaces\(\): void \{[\s\S]{0,220}revalidatePath\("\/"\)[\s\S]{0,120}revalidatePath\("\/sitemap\.xml"\)[\s\S]{0,120}revalidatePath\("\/rss\.xml"\)/.test(
      actionsSource,
    ) &&
      (actionsSource.match(/revalidatePublicSurfaces\(\);/g) ?? []).length === 4,
    `${(actionsSource.match(/revalidatePublicSurfaces\(\);/g) ?? []).length} appel(s)`,
  );

  const homeAfterEdit = await get("/");
  check(
    "accueil : titre modifié visible sans attendre (ISR invalidé)",
    homeAfterEdit.status === 200 && homeAfterEdit.body.includes(`Corrigé par l'éditeur ${TAG}`),
  );
  const sitemapAfterPublish = await get("/sitemap.xml");
  check(
    "sitemap : article publié présent sans attendre (ISR invalidé)",
    sitemapAfterPublish.status === 200 && sitemapAfterPublish.body.includes(slugs.aPublished),
  );

  /* ------------------------------------------------- 2 bis) Article premium */
  console.log("\n--- Article premium (réservé aux abonnés) ---");

  const setPremium = (slug, value) =>
    db.prepare("UPDATE Article SET isPremium = ? WHERE slug = ?").run(value ? 1 : 0, slug);
  const isPremium = (slug) =>
    db.prepare("SELECT isPremium FROM Article WHERE slug = ?").get(slug)?.isPremium === 1;

  check(
    "roles.ts : canSetPremium réservé aux ADMIN et EDITOR",
    /export function canSetPremium\(role: UserRole \| undefined \| null\): boolean \{\s*return role === "ADMIN" \|\| role === "EDITOR";/.test(
      readFileSync(path.join(ROOT, "src/lib/roles.ts"), "utf8"),
    ),
  );

  const newAsJournalist = await get("/studio/articles/new", { jar: authorJar });
  const newAsEditor = await get("/studio/articles/new", { jar: editorJar });
  check(
    "formulaire de création : case premium absente pour un journaliste",
    newAsJournalist.status === 200 &&
      !newAsJournalist.body.includes('name="isPremium"') &&
      newAsJournalist.body.includes("décidé par un éditeur ou un administrateur"),
  );
  check(
    "formulaire de création : case premium présente pour un éditeur",
    newAsEditor.status === 200 && newAsEditor.body.includes('name="isPremium"'),
  );

  setPremium(slugs.aDraft, true);
  const premiumEditView = await get(`/studio/articles/${articleId(slugs.aDraft)}/edit`, { jar: authorJar });
  check(
    "édition par l'auteur : état premium affiché, sans case à cocher",
    premiumEditView.status === 200 &&
      !premiumEditView.body.includes('name="isPremium"') &&
      premiumEditView.body.includes("Seuls un éditeur ou un administrateur peuvent modifier ce réglage"),
  );

  // Retrait du paywall : l'auteur enregistre son brouillon sans le champ. La
  // Server Action doit conserver la valeur en base (sinon un simple
  // enregistrement retirerait le paywall sans décision).
  await edit(authorJar, slugs.aDraft, { title: `Brouillon premium ${TAG}`, status: "REVIEW" });
  check(
    "enregistrement par l'auteur : le premium en base est conservé",
    isPremium(slugs.aDraft),
    `isPremium=${isPremium(slugs.aDraft)}`,
  );

  // Activation par un auteur : le champ est absent du formulaire, il peut être
  // forgé — la Server Action doit l'ignorer.
  setPremium(slugs.aDraft, false);
  await edit(authorJar, slugs.aDraft, { title: `Brouillon libre ${TAG}`, status: "REVIEW", isPremium: "on" });
  check(
    "auteur : champ premium forgé ignoré (l'article reste en accès libre)",
    !isPremium(slugs.aDraft),
    `isPremium=${isPremium(slugs.aDraft)}`,
  );

  const createdByJournalist = await submitForm(authorJar, "/studio/articles/new", {
    contains: 'name="title"',
    fields: {
      title: `Article premium forgé ${TAG}`,
      content: "Contenu de test.",
      slug: `${TAG}-premium-forge`,
      excerpt: "",
      coverImageUrl: "",
      categoryId,
      status: "DRAFT",
      isPremium: "on",
    },
  });
  check(
    "création par un journaliste : champ premium forgé ignoré",
    createdByJournalist.ok &&
      db.prepare("SELECT isPremium FROM Article WHERE slug = ?").get(`${TAG}-premium-forge`)?.isPremium === 0,
    `isPremium=${db.prepare("SELECT isPremium FROM Article WHERE slug = ?").get(`${TAG}-premium-forge`)?.isPremium}`,
  );

  const premiumByEditor = await edit(editorJar, slugs.aPublished, {
    title: `Premium par l'éditeur ${TAG}`,
    status: "PUBLISHED",
    isPremium: "on",
  });
  check(
    "éditeur : passage en premium d'un article publié",
    premiumByEditor.ok && isPremium(slugs.aPublished),
    `isPremium=${isPremium(slugs.aPublished)}`,
  );

  const freeByEditor = await edit(editorJar, slugs.aPublished, {
    title: `Accès libre rétabli ${TAG}`,
    status: "PUBLISHED",
  });
  check(
    "éditeur : retour en accès libre (case décochée)",
    freeByEditor.ok && !isPremium(slugs.aPublished),
    `isPremium=${isPremium(slugs.aPublished)}`,
  );

  // Vue lecture seule d'un article publié : l'auteur doit connaître sa diffusion.
  setPremium(slugs.aPublished, true);
  const readOnlyView = await get(`/studio/articles/${articleId(slugs.aPublished)}/edit`, { jar: authorJar });
  check(
    "vue lecture seule : diffusion indiquée à l'auteur",
    readOnlyView.status === 200 && readOnlyView.body.includes("Réservé aux abonnés (premium)"),
  );
  setPremium(slugs.aPublished, false);
  /* ------------------------------------------------------- 3) Suppression */
  console.log("\n--- Suppression ---");

  /**
   * Suppression : le bouton appelle la Server Action en JavaScript (aucun
   * `<form>` dans le HTML). On reproduit l'appel en multipart avec la référence
   * de l'action et le champ attendu par l'action, exactement comme le ferait le
   * client — puis on vérifie l'effet en base.
   */
  const deleteActionId = actionId("deleteArticle");
  check("identifiant de l'action de suppression trouvé", Boolean(deleteActionId), deleteActionId?.slice(0, 8));

  const deleteVia = async (jar, slug) => {
    const id = articleId(slug);
    const boundary = `----WP11${crypto.randomBytes(8).toString("hex")}`;
    const parts = [
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_${deleteActionId}"\r\n\r\n\r\n`,
      ),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${id}\r\n`),
      Buffer.from(`--${boundary}--\r\n`),
    ];
    const response = await request("POST", "/studio/articles", {
      jar,
      raw: Buffer.concat(parts),
      contentType: `multipart/form-data; boundary=${boundary}`,
      headers: { origin: ORIGIN, referer: `${ORIGIN}/studio/articles` },
    });
    return { ok: response.status < 400, status: response.status };
  };

  await deleteVia(authorJar, slugs.bPublished);
  check("journaliste : suppression de l'article d'un collègue refusée", exists(slugs.bPublished));

  await deleteVia(authorJar, slugs.aPublished);
  check("auteur : suppression de son article publié refusée", exists(slugs.aPublished));

  await deleteVia(editorJar, slugs.aPublished);
  check("éditeur : suppression d'un article publié refusée (réservé à l'admin)", exists(slugs.aPublished));

  // Article non publié : l'auteur et l'éditeur peuvent supprimer.
  addArticle(`${TAG}-a-trash`, `A à supprimer ${TAG}`, authorA.id, "DRAFT");
  await deleteVia(editorJar, `${TAG}-a-trash`);
  check("éditeur : suppression d'un brouillon autorisée", !exists(`${TAG}-a-trash`));

  addArticle(`${TAG}-a-trash2`, `A à supprimer 2 ${TAG}`, authorA.id, "REVIEW");
  await deleteVia(authorJar, `${TAG}-a-trash2`);
  check("auteur : suppression de son article en revue autorisée", !exists(`${TAG}-a-trash2`));

  addArticle(`${TAG}-b-trash`, `B à supprimer ${TAG}`, authorB, "DRAFT");
  await deleteVia(authorJar, `${TAG}-b-trash`);
  check("journaliste : suppression du brouillon d'un collègue refusée", exists(`${TAG}-b-trash`));

  await deleteVia(adminJar, slugs.aPublished);
  check("admin : suppression d'un article publié autorisée", !exists(slugs.aPublished));

  /* ---------------------------------------------------- 4) Création d'article */
  console.log("\n--- Création ---");

  const create = (jar, { title, status }) =>
    submitForm(jar, "/studio/articles/new", {
      contains: 'name="title"',
      fields: { title, content: "Contenu.", slug: "", excerpt: "", coverImageUrl: "", categoryId, status },
    });

  const createdTitle = `À relire ${TAG}`;
  await create(authorJar, { title: createdTitle, status: "REVIEW" });
  const createdReview = db.prepare("SELECT status, authorId FROM Article WHERE title = ?").get(createdTitle);
  check(
    "journaliste : création en « En revue » autorisée, auteur = session",
    createdReview?.status === "REVIEW" && createdReview?.authorId === authorA.id,
    `${createdReview?.status ?? "aucun"}`,
  );

  const editorTitle = `Publié par l'éditeur ${TAG}`;
  await create(editorJar, { title: editorTitle, status: "PUBLISHED" });
  const createdByEditor = db.prepare("SELECT status FROM Article WHERE title = ?").get(editorTitle);
  check(
    "éditeur : création directe en « Publié » autorisée",
    createdByEditor?.status === "PUBLISHED",
    String(createdByEditor?.status ?? "aucun"),
  );

  /* ------------------------------------------------------- 5) Interface */
  console.log("\n--- Interface du studio ---");

  // Articles dédiés aux contrôles d'interface (titres sans apostrophe ni
  // accent, pour éviter les entités HTML dans les assertions).
  const uiA = `UI A ${TAG}`;
  const uiB = `UI B ${TAG}`;
  const uiPublished = `UI P ${TAG}`;
  addArticle(`${TAG}-ui-a`, uiA, authorA.id, "DRAFT");
  addArticle(`${TAG}-ui-b`, uiB, authorB, "DRAFT");
  addArticle(`${TAG}-ui-p`, uiPublished, authorA.id, "PUBLISHED");

  const listAsAuthor = await get("/studio/articles", { jar: authorJar });
  const listAsEditor = await get("/studio/articles", { jar: editorJar });
  const listAsAdmin = await get("/studio/articles", { jar: adminJar });
  check(
    "la liste montre tous les articles à un journaliste",
    listAsAuthor.body.includes(uiA) && listAsAuthor.body.includes(uiB),
  );
  check(
    "actions limitées : mention de lecture seule sur l'article d'un collègue",
    listAsAuthor.body.includes("Article d&#x27;un autre auteur") ||
      listAsAuthor.body.includes("Article d'un autre auteur"),
  );
  check(
    "actions limitées : mention sur un article publié de l'auteur",
    /Article publié : hors périmètre de l&#x27;auteur|Article publié : hors périmètre de l'auteur/.test(listAsAuthor.body),
  );

  const rowOf = (html, title) => {
    const index = html.indexOf(title);
    if (index === -1) return "";
    const start = html.lastIndexOf("<tr", index);
    const end = html.indexOf("</tr>", index);
    return start === -1 || end === -1 ? "" : html.slice(start, end);
  };

  check(
    "journaliste : sélecteur de statut absent sur l'article d'un collègue",
    !rowOf(listAsAuthor.body, uiB).includes("<select"),
  );
  check(
    "journaliste : sélecteur de statut présent sur son article en brouillon",
    rowOf(listAsAuthor.body, uiA).includes("<select"),
  );
  check(
    "journaliste : pas de lien d'édition sur l'article d'un collègue",
    !rowOf(listAsAuthor.body, `B brouillon ${TAG}`).includes("Éditer"),
  );
  check(
    "journaliste : pas de bouton de suppression sur l'article d'un collègue",
    !rowOf(listAsAuthor.body, uiB).includes("Supprimer"),
  );
  check(
    "éditeur : lien d'édition sur l'article publié d'un journaliste",
    rowOf(listAsEditor.body, uiPublished).includes("Éditer"),
  );
  check(
    "éditeur : pas de bouton de suppression sur un article publié",
    !rowOf(listAsEditor.body, uiPublished).includes("Supprimer"),
  );
  check(
    "admin : bouton de suppression sur un article publié",
    rowOf(listAsAdmin.body, uiPublished).includes("Supprimer"),
  );

  const editAsAuthorOnOther = await get(`/studio/articles/${articleId(`${TAG}-ui-b`)}/edit`, { jar: authorJar });
  check(
    "page d'édition d'un article d'un collègue : lecture seule",
    editAsAuthorOnOther.status === 200 &&
      editAsAuthorOnOther.body.includes("Consulter l&#x27;article") &&
      !editAsAuthorOnOther.body.includes('name="title"'),
  );

  const editAsAuthorOnPublished = await get(`/studio/articles/${articleId(`${TAG}-ui-p`)}/edit`, { jar: authorJar });
  check(
    "page d'édition d'un article publié par un journaliste : lecture seule",
    editAsAuthorOnPublished.status === 200 &&
      editAsAuthorOnPublished.body.includes("Consulter l&#x27;article") &&
      !editAsAuthorOnPublished.body.includes('name="title"'),
  );

  const editAsEditor = await get(`/studio/articles/${articleId(`${TAG}-ui-p`)}/edit`, { jar: editorJar });
  check(
    "page d'édition d'un article publié par un éditeur : formulaire disponible",
    editAsEditor.status === 200 && editAsEditor.body.includes('name="title"'),
  );

  const ownEditPage = await get(`/studio/articles/${articleId(slugs.aDraft)}/edit`, { jar: authorJar });
  check(
    "page d'édition de son propre article : formulaire disponible",
    ownEditPage.status === 200 && ownEditPage.body.includes('name="title"'),
  );
  check(
    "statuts proposés à un journaliste : brouillon et en revue seulement",
    ownEditPage.body.includes("Votre rôle ne permet pas de publier") &&
      !/<option value="PUBLISHED"/.test(ownEditPage.body),
  );

  const newPageAsAuthor = await get("/studio/articles/new", { jar: authorJar });
  check(
    "formulaire de création : publication non proposée à un journaliste",
    !/<option value="PUBLISHED"/.test(newPageAsAuthor.body) && /<option value="REVIEW"/.test(newPageAsAuthor.body),
  );

  /* ------------------------------------------------------------ nettoyage */
  cleanup();
  db.close();

  const failed = results().filter((result) => !result).length;
  console.log(`\nRESULTAT: ${checks.length - failed}/${checks.length} vérifications réussies`);
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
