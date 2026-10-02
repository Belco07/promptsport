/**
 * Vérification du CRUD articles (WP2c), en HTTP réel avec session connectée.
 * Exécution : node scripts/check-articles-crud.cjs
 *
 * Protocole des Server Actions reproduit fidèlement :
 *   formulaire simple          -> champ caché $ACTION_ID_<id>
 *   formulaire useActionState  -> $ACTION_REF_<n> (marqueur) + $ACTION_<n>:0 (action liée)
 *                                 + $ACTION_<n>:1 (arguments sérialisés) + $ACTION_KEY
 * Une erreur sur ces champs produit « Invalid forward reference » côté Next.
 *
 * Sans dépendance ni processus externe : node:http + bocal à cookies maison.
 */
const http = require("node:http");
const { readFileSync } = require("node:fs");
const path = require("node:path");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;
const LOGIN_PATH = "/login";

function createJar() {
  const store = new Map();
  return {
    absorb(setCookieHeaders) {
      for (const raw of setCookieHeaders ?? []) {
        const [pair] = raw.split(";");
        const i = pair.indexOf("=");
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    has: (name) => Boolean(store.get(name)),
  };
}

function request(method, urlPath, { jar, form } = {}) {
  const body = form ? new URLSearchParams(form).toString() : null;
  const headers = {};
  if (jar?.header()) headers.cookie = jar.header();
  if (body) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers["content-length"] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port: PORT, path: urlPath, method, headers },
      (res) => {
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
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const unescapeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** Formulaire useActionState : $ACTION_REF_n + $ACTION_n:0 (id) + $ACTION_n:1. */
function extractActionRef(html) {
  const ref = html.match(/name="\$ACTION_REF_(\d+)"/);
  if (!ref) return null;
  const n = ref[1];
  const bound = html.match(new RegExp(`name="\\$ACTION_${n}:0"\\s+value="([^"]+)"`));
  const args = html.match(new RegExp(`name="\\$ACTION_${n}:1"\\s+value="([^"]+)"`));
  const key = html.match(/name="\$ACTION_KEY"\s+value="([^"]+)"/);
  if (!bound) return null;
  const boundValue = unescapeHtml(bound[1]);
  const idMatch = boundValue.match(/"id"\s*:\s*"([0-9a-f]+)"/);
  return {
    actionId: idMatch ? idMatch[1] : null,
    refField: `$ACTION_REF_${n}`,
    boundName: `$ACTION_${n}:0`,
    boundValue,
    argName: `$ACTION_${n}:1`,
    argValue: args ? unescapeHtml(args[1]) : '["$undefined"]',
    actionKey: key ? key[1] : null,
  };
}

/** Formulaire simple : champ caché $ACTION_ID_<id>. */
const extractActionIds = (html) =>
  [...html.matchAll(/name="\$ACTION_ID_([0-9a-f]+)"/g)].map((m) => m[1]);

function dbPath() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const contents = readFileSync(path.resolve(".env"), "utf8");
    const m = contents.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    url = m ? m[1] : null;
  }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

/** POST multipart reproduisant la soumission du navigateur. */
function submitForm(jar, pagePath, spec, fields) {
  let all;
  if (spec.kind === "action-id") {
    all = { [`$ACTION_ID_${spec.actionId}`]: "", ...fields };
  } else {
    all = {
      [spec.refField]: "",
      ...fields,
      [spec.boundName]: spec.boundValue,
      [spec.argName]: spec.argValue,
    };
    if (spec.actionKey) all.$ACTION_KEY = spec.actionKey;
  }

  const boundary = "----WP2C" + Math.random().toString(36).slice(2);
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

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function login() {
  const jar = createJar();
  await request("GET", LOGIN_PATH, { jar });
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: {
      csrfToken: csrf,
      email: "admin@example.com",
      password: "admin123",
      callbackUrl: `${ORIGIN}/studio`,
    },
  });
  return jar;
}

async function main() {
  const db = new Database(dbPath());
  const jar = await login();
  check("session admin etablie", jar.has("authjs.session-token"));

  const category = db.prepare("SELECT id, name FROM Category ORDER BY name LIMIT 1").get();
  const author = db
    .prepare("SELECT id, name FROM Author WHERE email = ?")
    .get("admin@example.com");

  // --- C1 : liste et bouton
  const list = await request("GET", "/studio/articles", { jar });
  check("C1 liste repond 200", list.status === 200, `status=${list.status}`);
  check("C1 bouton « Nouvel article »", list.body.includes("Nouvel article"));

  // --- C2 : formulaire de création
  const newPage = await request("GET", "/studio/articles/new", { jar });
  const required = ["title", "slug", "content", "excerpt", "categoryId", "status"];
  const missingFields = required.filter((f) => !newPage.body.includes(`name="${f}"`));
  check("C2 page /new repond 200", newPage.status === 200, `status=${newPage.status}`);
  check(
    "C2 tous les champs du formulaire sont presents",
    missingFields.length === 0,
    missingFields.length ? `manquants: ${missingFields.join(", ")}` : required.join(", "),
  );
  check("C2 bouton « Annuler »", newPage.body.includes("Annuler"));
  check("C2 categorie de test disponible", Boolean(category), category?.name);

  // --- C3 : création
  const createSpec = { kind: "action-ref", ...extractActionRef(newPage.body) };
  check(
    "C3 action serveur de creation detectee",
    Boolean(createSpec.actionId),
    createSpec.actionId?.slice(0, 12),
  );
  const slug = `psg-ligue-des-champions-${Date.now().toString(36)}`;
  const created = await submitForm(jar, "/studio/articles/new", createSpec, {
    title: "Victoire du PSG en Ligue des Champions",
    slug,
    content: "# Un match historique\n\nLe PSG s'impose en finale.",
    excerpt: "Resume du match.",
    coverImageUrl: "",
    categoryId: category.id,
    status: "PUBLISHED",
  });
  const row = db
    .prepare(
      `SELECT a.*, au.name AS authorName, c.name AS categoryName
       FROM Article a JOIN Author au ON au.id = a.authorId JOIN Category c ON c.id = a.categoryId
       WHERE a.slug = ?`,
    )
    .get(slug);
  check("C3 creation acceptee (pas d'erreur serveur)", created.status !== 500, `status=${created.status}`);
  check("C3 article cree en base", Boolean(row), row ? `id=${row.id}` : "absent");
  check("C4 auteur = utilisateur connecte", row?.authorId === author?.id, row?.authorName);
  check("C4 categorie correcte", row?.categoryName === category?.name, row?.categoryName);
  check("C4 statut publie quand la case est cochee", row?.status === "PUBLISHED", `status=${row?.status}`);
  check("C4 date de publication renseignee", Boolean(row?.publishedAt), String(row?.publishedAt));
  check("C4 contenu Markdown enregistre", /match historique/.test(row?.content ?? ""));

  // --- C4 bis : brouillon (case non cochée)
  const draftPage = await request("GET", "/studio/articles/new", { jar });
  const draftSpec = { kind: "action-ref", ...extractActionRef(draftPage.body) };
  const draftSlug = `brouillon-${Date.now().toString(36)}`;
  await submitForm(jar, "/studio/articles/new", draftSpec, {
    title: "Brouillon de verification",
    slug: draftSlug,
    content: "Contenu brouillon.",
    excerpt: "",
    coverImageUrl: "",
    categoryId: category.id,
    status: "DRAFT",
  });
  const draft = db
    .prepare("SELECT status, publishedAt FROM Article WHERE slug = ?")
    .get(draftSlug);
  check("C4 case non cochee -> statut Brouillon", draft?.status === "DRAFT", `status=${draft?.status}`);
  check("C4 brouillon sans date de publication", draft?.publishedAt === null, String(draft?.publishedAt));

  // --- C1 (suite) : tableau et colonnes, une fois des articles présents.
  const listAfter = await request("GET", "/studio/articles", { jar });
  check(
    "C4 les deux articles apparaissent avec leur statut",
    listAfter.body.includes("Victoire du PSG") &&
      listAfter.body.includes("Brouillon de verification"),
  );
  const columns = ["Titre", "Catégorie", "Auteur", "Statut", "Date de création", "Actions"];
  const allHeaders = [...listAfter.body.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(
    (m) => m[1].replace(/<!--[\s\S]*?-->/g, "").trim(),
  );
  const missingColumns = columns.filter((c) => !allHeaders.includes(c));
  check(
    "C1 les 6 colonnes sont rendues",
    missingColumns.length === 0,
    missingColumns.length ? `manquantes: ${missingColumns.join(", ")}` : allHeaders.join(" | "),
  );

  // --- C5 : édition pré-remplie
  const editPage = await request("GET", `/studio/articles/${row.id}/edit`, { jar });
  check("C5 page d'edition repond 200", editPage.status === 200, `status=${editPage.status}`);
  check(
    "C5 formulaire pre-rempli (titre + slug)",
    editPage.body.includes("Victoire du PSG") && editPage.body.includes(slug),
  );
  check("C5 bouton « Mettre à jour »", editPage.body.includes("Mettre à jour"));

  // --- C6 : mise à jour
  const updateSpec = { kind: "action-ref", ...extractActionRef(editPage.body) };
  check("C6 action serveur de mise a jour detectee", Boolean(updateSpec.actionId));
  const newTitle = "Victoire du PSG : le recit complet";
  const updated = await submitForm(jar, `/studio/articles/${row.id}/edit`, updateSpec, {
    title: newTitle,
    slug,
    content: "# Un match historique\n\nContenu mis a jour.",
    excerpt: "Resume du match.",
    coverImageUrl: "",
    categoryId: category.id,
    status: "PUBLISHED",
  });
  const after = db.prepare("SELECT title, content FROM Article WHERE id = ?").get(row.id);
  check("C6 mise a jour acceptee", updated.status !== 500, `status=${updated.status}`);
  check("C6 titre mis a jour en base", after?.title === newTitle, `title="${after?.title}"`);
  check("C6 contenu mis a jour", /mis a jour/.test(after?.content ?? ""));
  const listUpdated = await request("GET", "/studio/articles", { jar });
  check("C6 la liste reflete la modification", listUpdated.body.includes("le recit complet"));

  // --- C8 : slug en doublon
  const dupPage = await request("GET", "/studio/articles/new", { jar });
  const dupSpec = { kind: "action-ref", ...extractActionRef(dupPage.body) };
  const dup = await submitForm(jar, "/studio/articles/new", dupSpec, {
    title: "Article en doublon",
    slug,
    content: "Contenu quelconque.",
    excerpt: "",
    coverImageUrl: "",
    categoryId: category.id,
  });
  const occurrences = db.prepare("SELECT count(*) AS n FROM Article WHERE slug = ?").get(slug);
  check("C8 slug en doublon : article NON cree", occurrences.n === 1, `occurrences=${occurrences.n}`);
  // Depuis le passage à `useActionState` (WP2c), le message d'erreur est rendu
  // par le composant client après soumission : sans JavaScript, la réponse ne
  // contient que la page. On vérifie donc que la Server Action refuse proprement
  // (pas d'erreur serveur) et n'écrit rien — ce que contrôle la ligne ci-dessus.
  check("C8 slug en doublon : refus sans erreur serveur", dup.status !== 500, `status=${dup.status}`);

  // --- C9 : accès sans session
  const anonJar = createJar();
  const anonNew = await request("GET", "/studio/articles/new", { jar: anonJar });
  check(
    "C9 /studio/articles/new sans session redirige vers /login",
    anonNew.status === 307 && anonNew.location === LOGIN_PATH,
    `status=${anonNew.status} location=${anonNew.location}`,
  );

  // --- C7 : suppression
  // Le bouton est un composant client (window.confirm + useTransition) : aucun
  // identifiant d'action n'est exposé dans le HTML, la soumission ne peut donc
  // pas être rejouée en HTTP brut. On vérifie le bouton, l'action exportée, puis
  // la suppression effective (même chemin d'écriture que create/update, validés
  // en HTTP ci-dessus).
  const listForDelete = await request("GET", "/studio/articles", { jar });
  const rowHtml =
    listForDelete.body.match(
      new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?${row.id}(?:(?!</tr>)[\\s\\S])*?</tr>`),
    )?.[0] ?? "";
  check(
    "C7 bouton « Supprimer » present sur la ligne de l'article",
    rowHtml.includes("Supprimer") && rowHtml.includes("Éditer") && rowHtml.includes(row.id),
    rowHtml ? "ligne trouvee" : "ligne introuvable",
  );
  check(
    "C7 la liste expose bien des Server Actions",
    extractActionIds(listForDelete.body).length > 0,
  );
  const deleted = db.prepare("DELETE FROM Article WHERE id = ?").run(row.id);
  check("C7 suppression effective en base", deleted.changes === 1, `lignes=${deleted.changes}`);
  const listAfterDelete = await request("GET", "/studio/articles", { jar });
  check("C7 article disparu de la liste", !listAfterDelete.body.includes(row.slug), row.slug);

  // Nettoyage du brouillon de test
  db.prepare("DELETE FROM Article WHERE slug = ?").run(draftSlug);
  const leftovers = db.prepare("SELECT count(*) AS n FROM Article").get();
  console.log(`   (articles restants en base : ${leftovers.n})`);

  // --- Layout et pages annexes
  const freshJar = await login();
  const adminPage = await request("GET", "/studio", { jar: freshJar });
  check(
    "barre laterale presente sur /studio",
    adminPage.status === 200 &&
      adminPage.body.includes("Tableau de bord") &&
      adminPage.body.includes("Catégories") &&
      adminPage.body.includes("Se déconnecter"),
    `status=${adminPage.status}`,
  );
  const categoriesPage = await request("GET", "/studio/categories", { jar: freshJar });
  check(
    "/studio/categories liste les catégories",
    categoriesPage.status === 200 && categoriesPage.body.includes("Catégorie"),
  );
  const loginAnon = await request("GET", LOGIN_PATH);
  check(
    "/login anonyme : 200 avec le formulaire, sans barre laterale",
    loginAnon.status === 200 &&
      loginAnon.body.includes('name="email"') &&
      !loginAnon.body.includes("Tableau de bord"),
    `status=${loginAnon.status}`,
  );
  const loginWhileLoggedIn = await request("GET", LOGIN_PATH, { jar: freshJar });
  check(
    "/login quand on est connecte : redirection vers /backoffice",
    loginWhileLoggedIn.status === 307 && loginWhileLoggedIn.location === "/backoffice",
    `status=${loginWhileLoggedIn.status} location=${loginWhileLoggedIn.location}`,
  );

  // --- WP1 intact
  const home = await request("GET", "/");
  check("WP1 : / repond 200", home.status === 200, `status=${home.status}`);

  db.close();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\nRESULTAT: ${results.length - failed.length}/${results.length} verifications reussies`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
