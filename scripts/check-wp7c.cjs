/**
 * Vérification du WP7c — paywall et accès premium.
 * Exécution : node scripts/check-wp7c.cjs
 *
 * Le contrôle crée ses propres articles de test (premium et gratuit) puis les
 * supprime. Le formulaire du studio est réellement rejoué (protocole
 * `useActionState` : $ACTION_REF_n / $ACTION_n:0 / $ACTION_n:1) afin de prouver
 * que la case « Article premium » est bien enregistrée par la Server Action.
 */
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

const PREMIUM_SLUG = "article-verrouille-wp7c";
const FREE_SLUG = "article-gratuit-wp7c";
const EXCERPT_SLUG = "article-verrouille-extrait-wp7c";
const STUDIO_SLUG = "article-cree-par-le-studio-wp7c";

const PREMIUM_CONTENT = `PREFIXE-PREMIUM ${"x".repeat(250)} MARQUEUR-FIN-PREMIUM`;
const FREE_CONTENT = `PREFIXE-GRATUIT ${"y".repeat(250)} MARQUEUR-FIN-GRATUIT`;
const EXCERPT_CONTENT = `PREFIXE-EXCERPT ${"z".repeat(250)} MARQUEUR-FIN-EXCERPT`;
const EXCERPT_TEXT = "Extrait rédigé à la main pour les non-abonnés.";

/* ------------------------------------------------------------------ outils */

function dbPath() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const contents = readFileSync(path.resolve(".env"), "utf8");
    const m = contents.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    url = m ? m[1] : null;
  }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

function createJar() {
  const store = new Map();
  return {
    absorb(setCookieHeaders) {
      for (const raw of setCookieHeaders ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
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

function request(method, urlPath, { jar, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = { origin: ORIGIN, referer: `${ORIGIN}${urlPath}` };
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }
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

const unescapeHtml = (value) =>
  value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** Formulaire useActionState : $ACTION_REF_n + $ACTION_n:0 (id) + $ACTION_n:1. */
function extractActionRef(html) {
  const ref = html.match(/name="\$ACTION_REF_(\d+)"/);
  if (!ref) return null;
  const n = ref[1];
  const bound = html.match(new RegExp(`name="\\$ACTION_${n}:0"\\s+value="([^"]+)"`));
  const args = html.match(new RegExp(`name="\\$ACTION_${n}:1"\\s+value="([^"]+)"`));
  const key = html.match(/name="\$ACTION_KEY"\s+value="([^"]+)"/);
  if (!bound) return null;
  return {
    refField: `$ACTION_REF_${n}`,
    boundName: `$ACTION_${n}:0`,
    boundValue: unescapeHtml(bound[1]),
    argName: `$ACTION_${n}:1`,
    argValue: args ? unescapeHtml(args[1]) : '["$undefined"]',
    actionKey: key ? key[1] : null,
  };
}

/** POST multipart reproduisant la soumission du navigateur. */
function submitForm(jar, pagePath, spec, fields) {
  const all = {
    [spec.refField]: "",
    ...fields,
    [spec.boundName]: spec.boundValue,
    [spec.argName]: spec.argValue,
  };
  if (spec.actionKey) all.$ACTION_KEY = spec.actionKey;

  const boundary = "----WP7C" + crypto.randomBytes(8).toString("hex");
  const parts = [];
  for (const [name, value] of Object.entries(all)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const payload = Buffer.concat(parts);

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
    form: { csrfToken: csrf, email, password, callbackUrl: `${ORIGIN}/` },
  });
  return jar;
}

const cuid = () =>
  "c" + Date.now().toString(36) + crypto.randomBytes(8).toString("hex");

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

/* ------------------------------------------------------------------- tests */

async function main() {
  const db = new Database(dbPath());

  // 1) Colonne isPremium
  const columns = db.prepare("PRAGMA table_info(Article)").all().map((c) => c.name);
  check("Article.isPremium existe", columns.includes("isPremium"));

  const admin = db.prepare("SELECT id FROM Author WHERE email = ?").get("admin@example.com");
  const journalist = db.prepare("SELECT id FROM Author WHERE email = ?").get("journalist@example.com");
  const editor = db.prepare("SELECT id FROM Author WHERE email = ?").get("editor@example.com");
  const category = db.prepare("SELECT id FROM Category ORDER BY name LIMIT 1").get();
  const plan = db.prepare("SELECT id FROM Plan ORDER BY price LIMIT 1").get();
  if (!admin || !journalist || !editor || !category || !plan) {
    throw new Error("données de base manquantes (auteurs, catégorie ou plan)");
  }

  // 2) Articles de test
  const premiumId = cuid();
  const freeId = cuid();
  const excerptId = cuid();
  const studioId = cuid();
  const insertArticle = db.prepare(
    `INSERT INTO Article (id, title, slug, content, excerpt, coverImageUrl, status, publishedAt, isPremium, authorId, categoryId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, NULL, 'PUBLISHED', CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  const removeArticles = db.prepare(
    "DELETE FROM Article WHERE slug IN (?, ?, ?, ?)",
  );
  removeArticles.run(PREMIUM_SLUG, FREE_SLUG, EXCERPT_SLUG, STUDIO_SLUG);

  insertArticle.run(premiumId, "Article verrouillé WP7c", PREMIUM_SLUG, PREMIUM_CONTENT, null, 1, admin.id, category.id);
  insertArticle.run(freeId, "Article gratuit WP7c", FREE_SLUG, FREE_CONTENT, null, 0, admin.id, category.id);
  insertArticle.run(excerptId, "Article verrouillé avec extrait WP7c", EXCERPT_SLUG, EXCERPT_CONTENT, EXCERPT_TEXT, 1, admin.id, category.id);
  console.log("   (3 articles de test créés)\n");

  // 3) Badge sur la page d'accueil
  let home = await request("GET", "/");
  check("GET / -> 200", home.status === 200, `status=${home.status}`);
  const window = (title) => {
    const index = home.body.indexOf(title);
    return index < 0 ? "" : home.body.slice(index - 400, index + 1200);
  };
  // En production, l'accueil est prérendu avec `revalidate = 60`
  // (src/app/page.tsx). Ces trois articles étant insérés en SQL direct, le HTML
  // servi peut être antérieur à l'insertion — alors qu'en développement la page
  // est rendue à chaque requête. ISR fonctionne en « stale-while-revalidate » :
  // la première requête après expiration sert l'ancienne page et déclenche la
  // régénération, la suivante sert la nouvelle. On fait donc les deux lectures,
  // plutôt que de tolérer un faux échec.
  if (!window("Article verrouillé WP7c").includes("Premium")) {
    console.log("   (accueil en cache ISR : revalidation puis nouvelle lecture)");
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    home = await request("GET", "/");
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    home = await request("GET", "/");
  }
  check("accueil : badge « Premium » sur l'article premium",
    window("Article verrouillé WP7c").includes("Premium"));
  check("accueil : pas de badge sur l'article gratuit",
    !window("Article gratuit WP7c").includes("Premium"));

  // 4) Visiteur non connecté
  const anon = await request("GET", `/article/${PREMIUM_SLUG}`);
  check("visiteur : GET article premium -> 200", anon.status === 200, `status=${anon.status}`);
  check("visiteur : badge Premium sur la page de détail", anon.body.includes("Premium"));
  check("visiteur : titre du paywall", anon.body.includes("Cet article est réservé aux abonnés"));
  check("visiteur : bouton vers /abonnement",
    anon.body.includes('href="/abonnement"') && anon.body.includes("Voir les offres d&#x27;abonnement"));
  check("visiteur : lien « Déjà abonné ? Se connecter » vers /login",
    anon.body.includes("Déjà abonné ? Se connecter") && anon.body.includes('href="/login"'));
  check("visiteur : teaser = 200 premiers caractères du contenu",
    anon.body.includes(PREMIUM_CONTENT.slice(0, 200)));
  check("visiteur : fin de l'article masquée", !anon.body.includes("MARQUEUR-FIN-PREMIUM"));

  const anonFree = await request("GET", `/article/${FREE_SLUG}`);
  check("visiteur : article gratuit complet",
    anonFree.body.includes("MARQUEUR-FIN-GRATUIT") && !anonFree.body.includes("Cet article est réservé"));
  // On cherche la pastille elle-même, pas le mot « Premium » (présent dans la
  // charge RSC de streaming indépendamment du badge affiché).
  //
  // Depuis le WP9, la page d'un article gratuit propose des articles connexes,
  // qui peuvent être premium et donc porter leur propre pastille. Le contrôle
  // est donc restreint à l'en-tête de l'article (du <h1> à la fin du <header>),
  // seule zone où une pastille signalerait à tort un article payant.
  const headerStart = anonFree.body.indexOf("<h1");
  const headerEnd = anonFree.body.indexOf("</header>", headerStart);
  const articleHeader =
    headerStart >= 0 && headerEnd > headerStart ? anonFree.body.slice(headerStart, headerEnd) : "";
  const badgeInHeader = articleHeader.includes("border-amber-300 bg-amber-100");
  check(
    "visiteur : pas de badge sur l'article gratuit",
    articleHeader.length > 0 && !badgeInHeader,
    articleHeader.length === 0
      ? "en-tête non isolé (contrôle ignoré)"
      : badgeInHeader
        ? "pastille dans l'en-tête"
        : "en-tête sans pastille",
  );

  // 5) Extrait rédigé à la main
  const anonExcerpt = await request("GET", `/article/${EXCERPT_SLUG}`);
  check("visiteur : l'extrait remplace les 200 caractères",
    anonExcerpt.body.includes(EXCERPT_TEXT) && !anonExcerpt.body.includes("MARQUEUR-FIN-EXCERPT"));

  // 6) Connecté sans abonnement
  const journalistJar = await login("journalist@example.com", "password123");
  check("journaliste connecté", journalistJar.has("authjs.session-token"));
  const journalistView = await request("GET", `/article/${PREMIUM_SLUG}`, { jar: journalistJar });
  check("connecté sans abonnement : paywall affiché",
    journalistView.body.includes("Cet article est réservé aux abonnés") &&
      !journalistView.body.includes("MARQUEUR-FIN-PREMIUM"));
  check("connecté : pas de lien « Se connecter » sous le paywall",
    !journalistView.body.includes("Déjà abonné ? Se connecter"));

  // 7) Abonné actif (le compte admin possède un plan à vie ACTIVE)
  const adminJar = await login("admin@example.com", "admin123");
  const adminRows = db
    .prepare("SELECT COUNT(*) AS c FROM Subscription WHERE userId = ? AND status = 'ACTIVE' AND currentPeriodEnd > datetime('now')")
    .get(admin.id).c;
  check("admin : au moins un abonnement actif en base (prérequis)", adminRows > 0, `${adminRows} abonnement(s)`);
  const subscriberView = await request("GET", `/article/${PREMIUM_SLUG}`, { jar: adminJar });
  check("abonné actif : contenu complet",
    subscriberView.body.includes("MARQUEUR-FIN-PREMIUM") &&
      !subscriberView.body.includes("Cet article est réservé aux abonnés"));

  // 8) Abonnements non actifs : CANCELED, EXPIRED, ACTIVE mais expiré
  const editorJar = await login("editor@example.com", "password123");
  const clearEditor = db.prepare("DELETE FROM Subscription WHERE userId = ?");
  const insertSubscription = db.prepare(
    `INSERT INTO Subscription (id, userId, planId, status, stripeCustomerId, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );
  const future = new Date(Date.now() + 30 * 864e5).toISOString();
  const past = new Date(Date.now() - 30 * 864e5).toISOString();
  const now = new Date().toISOString();

  const cases = [
    { status: "ACTIVE", end: past, label: "ACTIVE mais période terminée" },
    { status: "CANCELED", end: future, label: "CANCELED" },
    { status: "EXPIRED", end: future, label: "EXPIRED" },
  ];
  for (const testCase of cases) {
    clearEditor.run(editor.id);
    insertSubscription.run(cuid(), editor.id, plan.id, testCase.status, now, testCase.end);
    const view = await request("GET", `/article/${PREMIUM_SLUG}`, { jar: editorJar });
    check(`abonnement ${testCase.label} : pas d'accès au contenu`,
      view.body.includes("Cet article est réservé aux abonnés") &&
        !view.body.includes("MARQUEUR-FIN-PREMIUM"));
  }
  clearEditor.run(editor.id);

  // 9) Studio : case à cocher
  const newPage = await request("GET", "/studio/articles/new", { jar: adminJar });
  check("studio (création) : case « Article premium »", newPage.body.includes('name="isPremium"') &&
    newPage.body.includes("Article premium"));
  check("studio (création) : décochée par défaut",
    !/name="isPremium"[^>]*checked/.test(newPage.body));

  const editPage = await request("GET", `/studio/articles/${premiumId}/edit`, { jar: adminJar });
  check("studio (édition) : case cochée pour un article premium",
    /name="isPremium"[^>]*checked/.test(editPage.body));

  // 10) Rejeu réel du formulaire du studio : création puis édition
  const createSpec = extractActionRef(newPage.body);
  check("formulaire de création analysé", Boolean(createSpec));
  if (createSpec) {
    await submitForm(adminJar, "/studio/articles/new", createSpec, {
      title: "Article créé par le studio WP7c",
      slug: STUDIO_SLUG,
      categoryId: category.id,
      content: "Contenu créé par le contrôle WP7c.",
      excerpt: "",
      coverImageUrl: "",
      status: "PUBLISHED",
      isPremium: "on",
    });
    const created = db.prepare("SELECT id, isPremium FROM Article WHERE slug = ?").get(STUDIO_SLUG);
    check("création via le studio : article enregistré", Boolean(created));
    check("création via le studio : isPremium = vrai", created?.isPremium === 1, String(created?.isPremium));

    if (created) {
      const editPage2 = await request("GET", `/studio/articles/${created.id}/edit`, { jar: adminJar });
      const updateSpec = extractActionRef(editPage2.body);
      check("formulaire d'édition analysé", Boolean(updateSpec));
      if (updateSpec) {
        await submitForm(adminJar, `/studio/articles/${created.id}/edit`, updateSpec, {
          title: "Article créé par le studio WP7c",
          slug: STUDIO_SLUG,
          categoryId: category.id,
          content: "Contenu créé par le contrôle WP7c.",
          excerpt: "",
          coverImageUrl: "",
          status: "PUBLISHED",
          // case décochée : le champ n'est pas envoyé
        });
        const updated = db.prepare("SELECT isPremium FROM Article WHERE slug = ?").get(STUDIO_SLUG);
        check("édition via le studio : isPremium repassé à faux", updated?.isPremium === 0, String(updated?.isPremium));
      }
    }
  }

  // Nettoyage
  clearEditor.run(editor.id);
  removeArticles.run(PREMIUM_SLUG, FREE_SLUG, EXCERPT_SLUG, STUDIO_SLUG);
  db.close();
  console.log("\n   (articles et abonnements de test supprimés)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("ERREUR:", error.stack);
  process.exitCode = 1;
});
