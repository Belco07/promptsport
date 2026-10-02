/**
 * Vérification du WP10b — engagement public : réactions, signalement, tri,
 * pagination et limitation de débit.
 * Exécution : PORT=3002 node scripts/check-wp10b.cjs
 *
 * Les composants clients (réactions optimistes, modale de signalement) sont
 * vérifiés de deux façons : leur code source (présence de `useOptimistic`, des
 * types autorisés, des compteurs publics) et l'appel direct des Server Actions
 * par le protocole `Next-Action`, exactement comme le ferait le navigateur.
 *
 * Les données créées sont préfixées « chk10b » et supprimées à la fin (la
 * suppression de l'article de test emporte commentaires, réactions et
 * signalements par cascade).
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

const readSource = (relative) => readFileSync(path.join(ROOT, relative), "utf8");
const engagement = readSource("src/lib/engagement.ts");
const rateLimit = readSource("src/lib/rate-limit.ts");
const actions = readSource("src/app/article/[slug]/actions.ts");
const commentReactions = readSource("src/components/CommentReactions.tsx");
const articleReactions = readSource("src/components/ArticleReactions.tsx");
const reportModal = readSource("src/components/ReportModal.tsx");
const commentsSection = readSource("src/components/CommentsSection.tsx");
const commentForm = readSource("src/components/CommentForm.tsx");
const articlePage = readSource("src/app/article/[slug]/page.tsx");

const TAG = `chk10b-${crypto.randomBytes(4).toString("hex")}`;
const MARKER = `${TAG}-marqueur`;
const slug = `${TAG}-article`;
const ids = {
  author: `${TAG}-user`,
  commenter: `${TAG}-user2`,
  category: `${TAG}-cat`,
  article: `${TAG}-art`,
  comments: Array.from({ length: 25 }, (_, index) => `${TAG}-cmt-${String(index).padStart(2, "0")}`),
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
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/` },
  });
  return jar;
}

/** Appel direct d'une Server Action (protocole Next-Action), comme le client. */
function callAction(jar, pagePath, actionId, args = []) {
  return request("POST", pagePath, {
    jar,
    raw: JSON.stringify(args),
    contentType: "text/plain;charset=UTF-8",
    headers: { "next-action": actionId, origin: ORIGIN },
  });
}

/** Identifiant d'une Server Action exportée (manifeste de la page). */
function actionId(exportedName) {
  const candidates = [
    ".next/server/app/article/[slug]/page/server-reference-manifest.json",
    ".next/server/app/[slug]/page/server-reference-manifest.json",
  ];
  for (const candidate of candidates) {
    const file = path.join(ROOT, candidate);
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const [id, entry] of Object.entries(manifest.node ?? {})) {
      if (entry?.exportedName === exportedName) return id;
    }
  }
  return null;
}

/** Champs cachés d'un formulaire (Server Action, champs sans `value` inclus). */
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

/** Soumet un formulaire à Server Action en multipart (comme un navigateur). */
async function submitForm(jar, urlPath, { contains, fields: extraFields = {}, harvestJar }) {
  const page = await get(urlPath, { jar: harvestJar ?? jar });
  const fields = formFields(page.body, contains);
  if (!fields) {
    return { ok: false, reason: "formulaire introuvable" };
  }

  const boundary = `----WP10B${crypto.randomBytes(8).toString("hex")}`;
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

const commentStatus = (id) => db.prepare("SELECT status FROM Comment WHERE id = ?").get(id)?.status;
const reactionRows = (commentId) =>
  db.prepare("SELECT type, authorId FROM CommentReaction WHERE commentId = ?").all(commentId);
const articleReactionRows = (articleId) =>
  db.prepare("SELECT type, authorId FROM ArticleReaction WHERE articleId = ?").all(articleId);
const commentCount = () => db.prepare("SELECT COUNT(*) AS c FROM Comment").get().c;

function cleanup() {
  db.prepare("DELETE FROM Article WHERE id = ?").run(ids.article);
  db.prepare("DELETE FROM Category WHERE id = ?").run(ids.category);
  db.prepare("DELETE FROM Comment WHERE content LIKE ?").run(`%${TAG}%`);
  db.prepare("DELETE FROM ArticleReaction WHERE authorId IN (?, ?)").run(ids.author, ids.commenter);
  db.prepare("DELETE FROM CommentReaction WHERE authorId IN (?, ?)").run(ids.author, ids.commenter);
  db.prepare("DELETE FROM Report WHERE reporterId IN (?, ?)").run(ids.author, ids.commenter);
  db.prepare("DELETE FROM Author WHERE id IN (?, ?)").run(ids.author, ids.commenter);
}

function createUser(id, name) {
  const hash = bcrypt.hashSync("password123", 10);
  db.prepare(
    `INSERT INTO Author (id, name, email, passwordHash, role, isPremium, slug, createdAt)
     VALUES (?, ?, ?, ?, 'JOURNALIST', 0, ?, ?)`,
  ).run(id, name, `${id}@example.test`, hash, id, new Date().toISOString());
}

const results = [];
function check(label, ok, detail) {
  results.push(Boolean(ok));
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  cleanup();

  /* -------------------------------------------------- 1) Fichiers et code */
  console.log("--- Composants et helpers ---");
  check("CommentReactions : composant client", commentReactions.startsWith('"use client"'));
  check("CommentReactions : UI optimiste (useOptimistic)", commentReactions.includes("useOptimistic"));
  check(
    "CommentReactions : trois réactions Like / Love / Laugh",
    commentReactions.includes("PUBLIC_COMMENT_REACTIONS") &&
      /PUBLIC_COMMENT_REACTIONS: ReactionType\[\] = \["LIKE", "LOVE", "LAUGH"\]/.test(engagement),
  );
  check(
    "CommentReactions : bouton désactivé + infobulle hors session",
    commentReactions.includes("disabled={!canReact") &&
      commentReactions.includes("Connectez-vous pour réagir"),
  );

  check("ArticleReactions : composant client", articleReactions.startsWith('"use client"'));
  check("ArticleReactions : UI optimiste", articleReactions.includes("useOptimistic"));
  check(
    "ArticleReactions : Like / Love / Bookmark",
    /ARTICLE_REACTION_TYPES: ReactionType\[\] = \["LIKE", "LOVE", "BOOKMARK"\]/.test(engagement),
  );
  check(
    "ArticleReactions : Bookmark sans compteur public",
    articleReactions.includes("PUBLIC_REACTION_COUNTERS") &&
      /PUBLIC_REACTION_COUNTERS: ReactionType\[\] = \["LIKE", "LOVE"\]/.test(engagement),
  );

  check("ReportModal : composant client", reportModal.startsWith('"use client"'));
  check(
    "ReportModal : raisons et détails",
    reportModal.includes("REPORT_REASONS") &&
      reportModal.includes('name="details"') &&
      reportModal.includes("REPORT_REASON_LABELS"),
  );

  check("CommentsSection : composant serveur", !commentsSection.includes('"use client"'));
  check("CommentsSection : 20 par page", commentsSection.includes("COMMENTS_PAGE_SIZE"));
  check(
    "CommentsSection : tri et pagination par paramètres d'URL",
    commentsSection.includes("commentsSort=") && commentsSection.includes("commentsPage="),
  );
  check("CommentsSection : bouton « Voir plus de commentaires »", commentsSection.includes("Voir plus de commentaires"));
  check("CommentForm : formulaire public", commentForm.includes("createComment") && commentForm.includes('name="content"'));

  check(
    "lib/engagement : tri (3 options) et pagination",
    /COMMENTS_PAGE_SIZE = 20/.test(engagement) &&
      ["recent", "oldest", "liked"].every((value) => engagement.includes(`"${value}"`)) &&
      engagement.includes("resolveCommentSort") &&
      engagement.includes("resolveCommentsPage"),
  );

  /* ------------------------------------------------ 2) Limitation de débit */
  console.log("\n--- Limitation de débit ---");
  check("limite : 10 par heure", /max: 10/.test(rateLimit) && /60 \* 60 \* 1000/.test(rateLimit));
  check("limite : stockage en mémoire (Map)", /new Map<string, Entry>/.test(rateLimit));
  check(
    "limite : limite multi-instances documentée",
    /multi-instances|multi-instance|serverless/i.test(rateLimit) && /Document|ASSUMÉE/i.test(rateLimit),
  );
  check(
    "limite : message du brief",
    /Vous avez atteint la limite de \$\{options\.max\} commentaires par heure\. Réessayez dans/.test(rateLimit),
  );
  check("limite : durée lisible (formatRetryAfter)", rateLimit.includes("export function formatRetryAfter"));
  check("limite : réinitialisation possible (tests)", rateLimit.includes("export function resetRateLimit"));
  check(
    "createComment applique la limite",
    actions.includes("consumeRateLimit") && actions.includes("commentaire=limite"),
  );

  /* ------------------------------------------------------- 3) Server Actions */
  console.log("\n--- Server Actions ---");
  for (const name of ["reactToComment", "reactToArticle", "reportComment"]) {
    check(`export ${name}`, new RegExp(`export async function ${name}\\(`).test(actions));
  }
  check(
    "sécurité : session et bannissement sur toutes les actions",
    /async function requireViewer/.test(actions) &&
      (actions.match(/await requireViewer\(\)/g) ?? []).length >= 3 &&
      actions.includes("isBanned(author)"),
  );
  check(
    "sécurité : types de réaction validés",
    actions.includes("PUBLIC_COMMENT_REACTIONS.includes(type)") &&
      actions.includes("ARTICLE_REACTION_TYPES.includes(type)") &&
      actions.includes("isReportReason(reason)"),
  );
  check(
    "unicité : changement de type = remplacement",
    /existing\?\.type === type/.test(actions) && actions.includes("commentReaction.update"),
  );
  check(
    "signalement : commentaire passé en FLAGGED",
    actions.includes('status: "FLAGGED"') && actions.includes("prisma.$transaction"),
  );

  /* -------------------------------------------------------- 4) Jeu de test */
  console.log("\n--- Jeu de test ---");
  createUser(ids.author, `Testeur ${TAG}`);
  createUser(ids.commenter, `Commentateur ${TAG}`);
  db.prepare(`INSERT INTO Category (id, name, slug, createdAt) VALUES (?, ?, ?, ?)`).run(
    ids.category,
    `Catégorie ${TAG}`,
    ids.category,
    new Date().toISOString(),
  );

  const now = new Date();
  db.prepare(
    `INSERT INTO Article (id, title, slug, content, excerpt, status, publishedAt, isPremium, authorId, categoryId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'PUBLISHED', ?, 0, ?, ?, ?, ?)`,
  ).run(
    ids.article,
    `Article de test ${TAG}`,
    slug,
    "Contenu de l'article de test.",
    "Résumé de test.",
    new Date(now.getTime() - 60_000).toISOString(),
    ids.author,
    ids.category,
    now.toISOString(),
    now.toISOString(),
  );

  // 25 commentaires approuvés pour tester la pagination, avec des dates
  // croissantes : le plus récent est le dernier inséré.
  const insertComment = db.prepare(
    `INSERT INTO Comment (id, content, articleId, authorId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'APPROVED', ?, ?)`,
  );
  ids.comments.forEach((id, index) => {
    const createdAt = new Date(now.getTime() - (ids.comments.length - index) * 60_000).toISOString();
    insertComment.run(id, `${MARKER} commentaire ${index + 1}`, ids.article, ids.commenter, createdAt, createdAt);
  });
  check("25 commentaires approuvés insérés", db.prepare("SELECT COUNT(*) AS c FROM Comment WHERE articleId = ?").get(ids.article).c === 25);

  const adminJar = await login("admin@example.com", "admin123");
  const authorJar = await login(`${ids.author}@example.test`, "password123");
  const commenterJar = await login(`${ids.commenter}@example.test`, "password123");
  check(
    "sessions de test ouvertes",
    adminJar.has("authjs.session-token") && authorJar.has("authjs.session-token") && commenterJar.has("authjs.session-token"),
  );

  /* ------------------------------------------------------- 5) Page publique */
  console.log("\n--- Page article : interface publique ---");
  const anon = await get(`/article/${slug}`);
  check("page article anonyme : 200", anon.status === 200, `status=${anon.status}`);
  check(
    "barre de réactions sous le titre",
    anon.body.includes("👍") && anon.body.includes("❤️") && anon.body.includes("🔖"),
  );
  check(
    "réactions désactivées et infobulle pour un visiteur",
    /title="Connectez-vous pour réagir"/.test(anon.body),
  );
  check("bouton Signaler présent", anon.body.includes(">Signaler<"));
  check(
    "tri affiché (3 options)",
    ["Plus récents", "Plus anciens", "Plus likés"].every((label) => anon.body.includes(label)),
  );
  // Le HTML rendu et la charge RSC du streaming contiennent le même contenu :
  // on compte donc les commentaires DISTINCTS (numéros uniques), dans l'ordre de
  // leur première apparition.
  const uniqueOrder = (body) => {
    const seen = new Set();
    const order = [];
    for (const match of body.matchAll(/marqueur commentaire (\d+)/g)) {
      const number = Number(match[1]);
      if (!seen.has(number)) {
        seen.add(number);
        order.push(number);
      }
    }
    return order;
  };

  check(
    "pagination : 20 commentaires puis « Voir plus »",
    uniqueOrder(anon.body).length === 20 &&
      // React insère des marqueurs de commentaire entre les nœuds de texte.
      anon.body.replace(/<!-- -->/g, "").includes("Voir plus de commentaires (5 restants)"),
    `${uniqueOrder(anon.body).length} commentaires rendus`,
  );

  const page2 = await get(`/article/${slug}?commentsPage=2`);
  check(
    "?commentsPage=2 : 25 commentaires, plus de bouton",
    uniqueOrder(page2.body).length === 25 && !page2.body.includes("Voir plus de commentaires"),
    `${uniqueOrder(page2.body).length} commentaires rendus`,
  );

  const oldest = await get(`/article/${slug}?commentsSort=oldest`);
  const recent = await get(`/article/${slug}?commentsSort=recent`);
  const oldestOrder = uniqueOrder(oldest.body);
  const recentOrder = uniqueOrder(recent.body);
  check(
    "tri « plus anciens » : du plus ancien au plus récent",
    oldestOrder[0] === 1 && oldestOrder.at(-1) === 20,
    `premier=${oldestOrder[0]} dernier=${oldestOrder.at(-1)}`,
  );
  check(
    "tri « plus récents » (défaut) : du plus récent au plus ancien",
    recentOrder[0] === 25 && recentOrder.at(-1) === 6,
    `premier=${recentOrder[0]} dernier=${recentOrder.at(-1)}`,
  );

  // « Plus likés » : deux réactions sur le commentaire 3, une sur le 4.
  db.prepare(
    `INSERT INTO CommentReaction (id, commentId, authorId, type, createdAt) VALUES (?, ?, ?, 'LIKE', ?)`,
  ).run(`${TAG}-rx-1`, ids.comments[2], ids.author, now.toISOString());
  db.prepare(
    `INSERT INTO CommentReaction (id, commentId, authorId, type, createdAt) VALUES (?, ?, ?, 'LIKE', ?)`,
  ).run(`${TAG}-rx-2`, ids.comments[2], ids.commenter, now.toISOString());
  db.prepare(
    `INSERT INTO CommentReaction (id, commentId, authorId, type, createdAt) VALUES (?, ?, ?, 'LOVE', ?)`,
  ).run(`${TAG}-rx-3`, ids.comments[3], ids.author, now.toISOString());

  const liked = await get(`/article/${slug}?commentsSort=liked`);
  const likedOrder = uniqueOrder(liked.body);
  check(
    "tri « plus likés » : le commentaire le plus réagi en tête",
    likedOrder[0] === 3 && likedOrder[1] === 4,
    `premier=${likedOrder[0]} deuxième=${likedOrder[1]}`,
  );

  // Ces réactions de test sont retirées : la suite vérifie ensuite les réactions
  // posées par les Server Actions, sur d'autres commentaires.
  db.prepare("DELETE FROM CommentReaction WHERE id LIKE ?").run(`${TAG}-rx-%`);

  /* --------------------------------------------------- 6) Réactions commentaire */
  console.log("\n--- Réactions sur un commentaire ---");
  const reactToCommentId = actionId("reactToComment");
  const reactToArticleId = actionId("reactToArticle");
  const reportCommentId = actionId("reportComment");
  check(
    "identifiants d'action trouvés dans le manifeste",
    Boolean(reactToCommentId && reactToArticleId && reportCommentId),
    `${reactToCommentId?.slice(0, 8) ?? "?"} / ${reactToArticleId?.slice(0, 8) ?? "?"} / ${reportCommentId?.slice(0, 8) ?? "?"}`,
  );

  const target = ids.comments[0];
  const like = await callAction(commenterJar, `/article/${slug}`, reactToCommentId, [target, "LIKE"]);
  check(
    "réaction LIKE enregistrée",
    like.status < 400 && reactionRows(target).length === 1 && reactionRows(target)[0].type === "LIKE",
    reactionRows(target).map((row) => row.type).join(", ") || "aucune",
  );
  check("réponse optimiste : état renvoyé", /"ok":true/.test(like.body) && /"LIKE":1/.test(like.body));

  const change = await callAction(commenterJar, `/article/${slug}`, reactToCommentId, [target, "LOVE"]);
  const afterChange = reactionRows(target);
  check(
    "changer de type remplace la réaction (une seule ligne)",
    change.status < 400 && afterChange.length === 1 && afterChange[0].type === "LOVE",
    afterChange.map((row) => row.type).join(", "),
  );

  const toggleOff = await callAction(commenterJar, `/article/${slug}`, reactToCommentId, [target, "LOVE"]);
  check(
    "recliquer la même réaction la retire",
    toggleOff.status < 400 && reactionRows(target).length === 0,
    `${reactionRows(target).length} réaction(s)`,
  );

  const invalid = await callAction(commenterJar, `/article/${slug}`, reactToCommentId, [target, "DISLIKE"]);
  check(
    "type non autorisé refusé",
    /"ok":false/.test(invalid.body) && /Réaction non autorisée/.test(invalid.body) && reactionRows(target).length === 0,
  );

  const anonymous = await callAction(null, `/article/${slug}`, reactToCommentId, [target, "LIKE"]);
  check(
    "visiteur refusé",
    /"ok":false/.test(anonymous.body) && /Connectez-vous/.test(anonymous.body) && reactionRows(target).length === 0,
  );

  /* ------------------------------------------------------ 7) Réactions article */
  console.log("\n--- Réactions sur l'article ---");
  const articleLike = await callAction(authorJar, `/article/${slug}`, reactToArticleId, [ids.article, "LIKE"]);
  check(
    "réaction LIKE sur l'article",
    articleLike.status < 400 && articleReactionRows(ids.article).some((row) => row.type === "LIKE"),
    articleReactionRows(ids.article).map((row) => row.type).join(", "),
  );

  const bookmark = await callAction(authorJar, `/article/${slug}`, reactToArticleId, [ids.article, "BOOKMARK"]);
  check(
    "Bookmark enregistré (privé)",
    bookmark.status < 400 && articleReactionRows(ids.article).some((row) => row.type === "BOOKMARK"),
  );
  const publicView = await get(`/article/${slug}`, { jar: authorJar });
  check(
    "aucun compteur public pour le Bookmark",
    publicView.body.includes("Enregistré") && !/>🔖<\/span><span class="tabular-nums"/.test(publicView.body),
  );

  /* --------------------------------------------------------- 8) Signalement */
  console.log("\n--- Signalement public ---");
  const reportTarget = ids.comments[5];
  const report = await callAction(authorJar, `/article/${slug}`, reportCommentId, [
    reportTarget,
    "SPAM",
    "Test de signalement",
  ]);
  const reportRow = db.prepare("SELECT status, reason, reporterId FROM Report WHERE commentId = ?").get(reportTarget);
  check(
    "signalement créé et commentaire passé en FLAGGED",
    report.status < 400 && reportRow?.status === "PENDING" && commentStatus(reportTarget) === "FLAGGED",
    `signalement=${reportRow?.status ?? "aucun"} commentaire=${commentStatus(reportTarget)}`,
  );
  check(
    "le commentaire signalé n'est plus visible publiquement",
    !(await get(`/article/${slug}`)).body.includes(`${MARKER} commentaire 6`),
  );

  const duplicate = await callAction(authorJar, `/article/${slug}`, reportCommentId, [reportTarget, "OTHER"]);
  check(
    "signalement en double refusé",
    /"ok":false/.test(duplicate.body) && /déjà signalé/.test(duplicate.body),
  );

  const ownComment = await callAction(commenterJar, `/article/${slug}`, reportCommentId, [ids.comments[6], "SPAM"]);
  check(
    "impossible de signaler son propre commentaire",
    /"ok":false/.test(ownComment.body) && /propre commentaire/.test(ownComment.body),
  );

  const badReason = await callAction(authorJar, `/article/${slug}`, reportCommentId, [ids.comments[7], "INCONNU"]);
  check("motif invalide refusé", /"ok":false/.test(badReason.body) && /invalide/.test(badReason.body));

  /* ------------------------------------------------------- 9) Bannissement */
  console.log("\n--- Bannissement ---");
  db.prepare("UPDATE Author SET bannedUntil = ?, banReason = ? WHERE id = ?").run(
    new Date(Date.now() + 86_400_000).toISOString(),
    "Test de bannissement",
    ids.commenter,
  );
  const bannedReaction = await callAction(commenterJar, `/article/${slug}`, reactToCommentId, [ids.comments[8], "LIKE"]);
  check(
    "un auteur banni ne peut pas réagir",
    /"ok":false/.test(bannedReaction.body) && /banni/.test(bannedReaction.body) && reactionRows(ids.comments[8]).length === 0,
  );
  const bannedReport = await callAction(commenterJar, `/article/${slug}`, reportCommentId, [ids.comments[9], "SPAM"]);
  check(
    "un auteur banni ne peut pas signaler",
    /"ok":false/.test(bannedReport.body) && /banni/.test(bannedReport.body),
  );
  const bannedView = await get(`/article/${slug}`, { jar: commenterJar });
  check(
    "réactions désactivées pour un auteur banni",
    /title="Votre compte est temporairement banni"/.test(bannedView.body),
  );

  /* --------------------------------------------------- 10) Limitation de débit */
  console.log("\n--- Limitation de débit (10 commentaires / heure) ---");
  // L'auteur de test n'a pas encore commenté : dix dépôts passent, le onzième non.
  let allowed = 0;
  let blocked = null;
  for (let index = 0; index < 11; index += 1) {
    const attempt = await submitForm(authorJar, `/article/${slug}`, {
      contains: 'name="slug"',
      fields: { content: `${MARKER} dépôt ${index + 1}` },
    });
    const location = String(attempt.location ?? "");
    if (location.includes("commentaire=en-attente")) {
      allowed += 1;
    } else if (location.includes("commentaire=limite")) {
      blocked = location;
      break;
    }
  }
  check("10 commentaires autorisés", allowed === 10, `${allowed} acceptés`);
  check("11e commentaire bloqué", Boolean(blocked), blocked ?? "aucun blocage");
  const limitMessage = (await get(`/article/${slug}?commentaire=limite`, { jar: authorJar })).body;
  check(
    "message de limite affiché avec le délai",
    /Vous avez atteint la limite de 10 commentaires par heure\. Réessayez dans \d+ (min|s|h)/.test(limitMessage),
    limitMessage.match(/Vous avez atteint[^<]*/)?.[0]?.slice(0, 90),
  );

  /* ------------------------------------------------ 11) LCP et périmètre */
  console.log("\n--- Performance et périmètre ---");
  check(
    "réactions de l'article chargées dans un Suspense (LCP préservé)",
    /Suspense fallback=\{<ArticleReactionsFallback/.test(articlePage),
  );
  check(
    "image de couverture toujours prioritaire",
    /priority\s+fetchPriority="high"/.test(articlePage),
  );
  check(
    "section commentaires après l'article dans le HTML",
    anon.body.indexOf('id="commentaires"') > anon.body.indexOf("<article>"),
    `position commentaires=${anon.body.indexOf('id="commentaires"')}`,
  );
  check(
    "aucune mention @username ni notification",
    !/@\w+/.test(commentsSection) && !commentsSection.includes("notification"),
  );
  check(
    "aucune bibliothèque d'état ou d'icônes ajoutée",
    !/from "(zustand|jotai|redux|react-icons|@heroicons|@radix-ui)/.test(
      commentReactions + articleReactions + reportModal + commentsSection,
    ),
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
