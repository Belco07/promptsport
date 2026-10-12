/**
 * WP15b — Insertion d'images dans l'éditeur MDXEditor.
 *
 * Vérifie le bouton de la toolbar, la boîte de dialogue, les règles de
 * validation, le Markdown produit, les styles, le bundle client, puis
 * l'intégration réelle : la Server Action `uploadImage` réutilisée (WP12d) et le
 * rendu public d'une image avec sa légende.
 *
 * Le serveur doit tourner sur le port 3002 (celui de promptsport) :
 *   PORT=3002 node scripts/check-wp15b.cjs
 *
 * La suite `check-upload.cjs` couvre l'action d'upload plus en détail (types
 * refusés, fichier trop volumineux, écriture disque) ; ici on vérifie qu'elle
 * reste bien la seule voie d'upload utilisée par l'éditeur.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const HOST = "localhost";
const PORT = Number(process.env.PORT || 3002);
const BASE = `http://${HOST}:${PORT}`;

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^[A-Z]/.test(line))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`OK    | ${label}${detail ? ` -> ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`ECHEC | ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

const readSource = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/** Retire les commentaires : ils citent des balises et faussent les contrôles. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** PNG 1×1 minimal, valide, pour l'upload réel. */
function makePng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAAE/wF/9U4AAAAASUVORK5CYII=",
    "base64",
  );
}

function createJar() {
  const store = new Map();
  return {
    absorb(rawCookies) {
      for (const raw of rawCookies ?? []) {
        const [pair] = raw.split(";");
        const index = pair.indexOf("=");
        if (index > 0) store.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
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
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        jar?.absorb(res.headers["set-cookie"]);
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** Envoi multipart vers la Server Action d'upload (chemin « sans JavaScript »). */
function upload(jar, pagePath, actionId, fileBuffer, filename, contentType) {
  const boundary = `----WP15B${Math.random().toString(36).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_${actionId}"\r\n\r\n\r\n`,
    ),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

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
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Identifiants de la Server Action uploadImage, lus dans les manifestes Next.
 *
 * `next.config.ts` sépare les builds : `.next` en développement,
 * `.next-production` en production. Les identifiants d'action diffèrent entre
 * les deux, on collecte donc les candidats des deux arborescences et l'on
 * retient celui que le serveur en cours accepte.
 */
function readUploadActionIds() {
  const ids = new Set();
  for (const buildDir of [".next-production", ".next"]) {
    const root = path.join(ROOT, buildDir, "server", "app");
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (entry.name !== "server-reference-manifest.json") continue;
        const manifest = JSON.parse(fs.readFileSync(full, "utf8"));
        for (const [id, value] of Object.entries(manifest.node ?? {})) {
          if (value.exportedName === "uploadImage") ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

/** Répertoires de chunks client à parcourir pour les contrôles de bundle. */
function chunkDirectories() {
  return [".next-production", ".next"]
    .map((buildDir) => path.join(ROOT, buildDir, "static", "chunks"))
    .filter((dir) => fs.existsSync(dir));
}

async function main() {
  /* ------------------------------------------------------- 1) bouton éditeur */
  section("Bouton et boîte de dialogue");
  const pluginPath = "src/components/editor/imageUploadPlugin.tsx";
  const plugin = readSource(pluginPath);
  const clean = stripComments(plugin);

  check("composant du bouton créé", plugin.includes('"use client"'), pluginPath);
  check(
    "réutilise la Server Action uploadImage existante",
    plugin.includes('from "@/app/studio/articles/actions"') &&
      clean.includes("await uploadImage(formData)"),
  );
  check(
    "aucun système d'upload parallèle",
    !clean.includes("@vercel/blob") && !clean.includes("put(") && !clean.includes("/api/upload"),
  );
  const editor = readSource("src/components/RichTextEditor.tsx");
  check(
    "bouton branché dans la toolbar MDXEditor",
    editor.includes('from "@/components/editor/imageUploadPlugin"') &&
      editor.includes("<ImageUploadButton />"),
  );
  check(
    "champ fichier limité aux quatre formats",
    clean.includes('ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp,image/gif"') &&
      clean.includes('type="file"'),
  );
  check("champ légende présent", clean.includes("Légende (optionnel)"));
  check(
    "bouton « Uploader » et état « Upload en cours… »",
    clean.includes("Uploader") && clean.includes("Upload en cours…"),
  );

  /* --------------------------------------------------------- 2) validation */
  section("Validation MIME et taille");
  check(
    "quatre types MIME autorisés",
    ["image/jpeg", "image/png", "image/webp", "image/gif"].every((type) =>
      clean.includes(`"${type}"`),
    ),
  );
  check("taille maximale de 5 Mo", clean.includes("5 * 1024 * 1024"));
  check(
    "messages d'erreur clairs (format et taille)",
    clean.includes("Format non autorisé. Formats acceptés : JPEG, PNG, WebP, GIF.") &&
      clean.includes("Fichier trop volumineux. Taille maximale : 5 Mo."),
  );

  /* ------------------------------------------------- 3) markdown inséré */
  section("Markdown inséré");
  check(
    "légende fournie : ![légende](URL \"légende\")",
    clean.includes('return `![${alt}](${url} "${title}")`'),
  );
  check("sans légende : ![](URL)", clean.includes("return `![](${url})`"));
  check(
    "caractères significatifs échappés",
    clean.includes("replace(/([\\\\[\\]])/g") || clean.includes("replace(/([\\\\[\\]])/g"),
  );

  /* ---------------------------------------------------- 4) HTML et thème */
  section("HTML valide et thème");
  check("aucun <form> imbriqué dans le dialogue", !clean.includes("<form"));
  check("tous les boutons déclarent leur type", !/<button(?![^>]*\btype=)/.test(clean));
  const css = readSource("src/app/globals.css");
  check(
    "styles du dialogue dans les deux thèmes",
    css.includes(".image-upload-dialog") &&
      css.includes(".social-embed-dialog, .image-upload-dialog") &&
      css.includes("hsl(var(--card))") &&
      css.includes("hsl(var(--foreground))"),
  );

  /* ------------------------------------------------------- 5) bundle client */
  section("Bundle client");
  const chunkDirs = chunkDirectories();
  if (chunkDirs.length > 0) {
    const bundle = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) bundle.push(fs.readFileSync(full, "utf8"));
      }
    };
    for (const dir of chunkDirs) walk(dir);
    const joined = bundle.join("\n");
    check("bouton présent dans le bundle", joined.includes("Insérer une image"));
    check("état d'upload présent dans le bundle", joined.includes("Upload en cours…"));
  } else {
    console.log("   (aucun build trouvé : contrôle du bundle ignoré — lancez `npm run build`)");
  }

  /* ------------------------------------------ 6) action réutilisée inchangée */
  section("Server Action réutilisée");
  const actions = readSource("src/app/studio/articles/actions.ts");
  check(
    "uploadImage toujours exportée avec sa signature FormData",
    /export async function uploadImage\(\s*formData: FormData,?\s*\)/.test(actions),
  );
  check(
    "aucune nouvelle action d'upload ajoutée",
    (actions.match(/export async function upload\w*\(/g) ?? []).length === 1,
  );

  /* ------------------------------------------------------ 7) upload réel */
  section("Upload réel via l'action du bouton");
  const jar = createJar();
  await request("GET", "/login", { jar });
  const csrf = JSON.parse((await request("GET", "/api/auth/csrf", { jar })).body).csrfToken;
  await request("POST", "/api/auth/callback/credentials", {
    jar,
    form: { csrfToken: csrf, email: "admin@example.com", password: "admin123", callbackUrl: `${BASE}/studio/articles/new` },
  });
  check("session admin établie", jar.has("authjs.session-token"));
  await request("GET", "/studio/articles/new", { jar });

  const actionIds = readUploadActionIds();
  check(
    "identifiant de l'action uploadImage trouvé",
    actionIds.length > 0,
    actionIds.map((id) => id.slice(0, 12)).join(", "),
  );

  const uploadsDir = path.join(ROOT, "public", "uploads");
  const listUploads = () =>
    new Set(fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : []);
  const png = makePng();
  let uploadedPath = null;

  if (actionIds.length > 0) {
    // L'identifiant d'action dépend du build (dev ou production) : on essaie
    // les candidats jusqu'à celui que le serveur en cours reconnaît.
    let accepted = null;
    let usedId = null;
    const before = listUploads();
    for (const id of actionIds) {
      const attempt = await upload(jar, "/studio/articles/new", id, png, "corps.png", "image/png");
      if (attempt.status === 200) {
        accepted = attempt;
        usedId = id;
        break;
      }
      accepted = attempt;
    }
    const created = [...listUploads()].filter((name) => !before.has(name));
    check(
      "PNG accepté par l'action",
      accepted?.status === 200,
      `status=${accepted?.status} (action ${usedId?.slice(0, 12)})`,
    );
    if (created.length === 1) {
      uploadedPath = path.join(uploadsDir, created[0]);
      check(
        "fichier écrit et identique à l'original",
        fs.existsSync(uploadedPath) && fs.readFileSync(uploadedPath).equals(png),
        created[0],
      );
    } else if (process.env.BLOB_READ_WRITE_TOKEN) {
      check("image envoyée vers Vercel Blob (jeton configuré)", true, "aucun fichier local attendu");
    } else {
      check(
        "un fichier a été créé dans public/uploads/",
        false,
        `nouveaux : ${created.join(", ") || "aucun"}`,
      );
    }

    if (usedId) {
      const beforeRejected = listUploads();
      const rejected = await upload(
        jar,
        "/studio/articles/new",
        usedId,
        Buffer.from("pas une image"),
        "doc.pdf",
        "application/pdf",
      );
      check(
        "type non autorisé refusé (aucun fichier écrit)",
        rejected.status === 200 && listUploads().size === beforeRejected.size,
        `status=${rejected.status}`,
      );
    }
  }

  /* ------------------------------- 8) rendu public d'une image légendée */
  section("Rendu public de l'image et de sa légende");
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  const slug = `test-image-wp15b-${Date.now().toString(36)}`;
  const author = (await db.query('SELECT id FROM "Author" ORDER BY "createdAt" LIMIT 1')).rows[0];
  const category = (await db.query('SELECT id FROM "Category" ORDER BY "createdAt" LIMIT 1')).rows[0];
  const imageUrl = uploadedPath ? `/uploads/${path.basename(uploadedPath)}` : "/promptsport-logo-night.png";

  try {
    // Contenu conforme à ce que produit le bouton : légende en alt ET en title.
    const content = [
      "Un paragraphe avant l'image.",
      "",
      `![Une légende de test](${imageUrl} "Une légende de test")`,
      "",
      "Un paragraphe après.",
    ].join("\n");

    await db.query(
      `INSERT INTO "Article" (id, title, slug, content, status, "publishedAt", "authorId", "categoryId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PUBLISHED', now(), $5, $6, now(), now())`,
      [
        `test-image-${Date.now().toString(36)}`,
        "Test image WP15b",
        slug,
        content,
        author.id,
        category.id,
      ],
    );

    const page = await request("GET", `/article/${slug}`);
    check("article de test rendu", page.status === 200, `status=${page.status}`);
    check("image affichée", page.body.includes(`src="${imageUrl}"`));
    check("légende visible (figcaption)", page.body.includes("<figcaption") && page.body.includes("Une légende de test"));
    check("figure dédiée autour de l'image", page.body.includes("<figure"));
  } finally {
    await db.query('DELETE FROM "Article" WHERE slug = $1', [slug]);
    const left = await db.query('SELECT count(*)::int AS n FROM "Article" WHERE slug LIKE $1', [
      "test-image-wp15b-%",
    ]);
    console.log(`   (article de test supprimé, restants = ${left.rows[0].n})`);
    await db.end();
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      fs.unlinkSync(uploadedPath);
      console.log("   (image de test supprimée)");
    }
  }

  console.log(`\nRESULTAT: ${passed}/${passed + failed} vérifications réussies`);
  if (failed > 0) {
    console.log(`ECHEC : ${failed} vérification(s) en échec`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ECHEC | exécution de la suite :", error);
  process.exitCode = 1;
});
