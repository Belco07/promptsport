/**
 * Test réel de l'upload d'image (WP2e) via la Server Action uploadImage.
 * Exécution : node scripts/check-upload.cjs
 */
const http = require("node:http");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);
const ORIGIN = `http://${HOST}:${PORT}`;

/**
 * Lit l'ID de la Server Action uploadImage depuis les manifestes générés.
 * Les manifestes n'existent qu'après la compilation de la page : on les lit donc
 * juste avant les tests, une fois /studio/articles/new réchauffé.
 *
 * WP12a : la page est passée de /studio/articles/new à /studio/articles/new ; on
 * parcourt tous les manifestes plutôt que de coder un chemin en dur, pour que la
 * suite survive aux renommages de route.
 */
function readUploadActionId() {
  const root = path.join(process.cwd(), ".next", "server", "app");
  const { existsSync, readdirSync } = require("node:fs");
  if (!existsSync(root)) {
    return null;
  }
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name !== "server-reference-manifest.json") {
        continue;
      }
      const manifest = JSON.parse(readFileSync(full, "utf8"));
      for (const [id, value] of Object.entries(manifest.node ?? {})) {
        if (value.exportedName === "uploadImage") {
          return id;
        }
      }
    }
  }
  return null;
}

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
    const req = http.request({ host: HOST, port: PORT, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
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

/** Envoie un fichier multipart à la Server Action d'upload. */
function upload(jar, pagePath, actionId, fileBuffer, filename, contentType) {
  const boundary = "----UPLOAD" + Math.random().toString(36).slice(2);
  const parts = [];
  // WP12a : l'action est déclenchée par le champ de formulaire `$ACTION_ID_xxx`
  // (chemin « sans JavaScript »), et non par l'en-tête `next-action` : ce dernier
  // attend l'encodage flight de React pour les champs non-fichiers, que ce
  // harnais ne reproduit pas (Réponse 500 « Connection closed. »). Le formulaire
  // envoyé par le navigateur sans JavaScript emprunte exactement ce chemin.
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_${actionId}"\r\n\r\n\r\n`,
    ),
  );
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
  );
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
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
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Petit PNG 1x1 valide (rouge).
function makePng() {
  const b = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9WQAAAAASUVORK5CYII=",
    "base64",
  );
  return b;
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

async function main() {
  const jar = createJar();
  await request("GET", "/login", { jar });
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
  check("session admin établie", jar.has("authjs.session-token"));

  // Réchauffe la page pour forcer la compilation (et générer le manifeste).
  await request("GET", "/studio/articles/new", { jar });

  const UPLOAD_ACTION_ID = readUploadActionId();
  check("ID d'action uploadImage trouvé", Boolean(UPLOAD_ACTION_ID), UPLOAD_ACTION_ID?.slice(0, 12));
  if (!UPLOAD_ACTION_ID) {
    console.error("Impossible de poursuivre sans l'ID d'action.");
    process.exit(1);
  }

  // 1) Upload d'un PNG valide.
  //
  // WP12a : le chemin « sans JavaScript » exécute bien l'action mais ne renvoie
  // pas sa valeur de retour (aucun `useActionState` ici) ; on constate donc le
  // résultat par ses effets — l'apparition d'un fichier dans public/uploads/.
  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  const { existsSync, readdirSync } = require("node:fs");
  const listUploads = () => new Set(existsSync(uploadsDir) ? readdirSync(uploadsDir) : []);
  const png = makePng();
  const before1 = listUploads();
  const res1 = await upload(jar, "/studio/articles/new", UPLOAD_ACTION_ID, png, "couverture.png", "image/png");
  check("upload PNG accepté (pas d'erreur HTTP)", res1.status === 200, `status=${res1.status}`);
  const created = [...listUploads()].filter((name) => !before1.has(name));
  const uploadedUrl = created.length === 1 ? `/uploads/${created[0]}` : null;
  check(
    "un fichier PNG a été créé dans public/uploads/",
    Boolean(uploadedUrl),
    uploadedUrl ?? `nouveaux fichiers : ${created.join(", ") || "aucun"}`,
  );

  // 2) Le fichier a-t-il été écrit sur le disque ?
  if (uploadedUrl) {
    const diskPath = path.join(process.cwd(), "public", uploadedUrl.replace(/^\//, ""));
    const exists = existsSync(diskPath);
    check("fichier écrit dans public/uploads/", exists, diskPath);
    if (exists) {
      const onDisk = readFileSync(diskPath);
      check("contenu identique", onDisk.equals(png), `${onDisk.length} octets`);
      require("node:fs").unlinkSync(diskPath);
      console.log("   (fichier de test supprimé)");
    }
  }

  // 3) Type non autorisé refusé : l'action répond sans erreur mais n'écrit rien.
  const before2 = listUploads();
  const res2 = await upload(jar, "/studio/articles/new", UPLOAD_ACTION_ID, Buffer.from("not an image"), "doc.pdf", "application/pdf");
  const rejected2 = res2.status === 200 && listUploads().size === before2.size;
  check("PDF refusé (aucun fichier écrit)", rejected2, `status=${res2.status}`);

  // 4) Fichier trop volumineux refusé (5,5 Mo : au-dessus de la limite de 5 Mo de
  // l'action, en dessous de la limite de 6 Mo du corps des Server Actions).
  const before3 = listUploads();
  const big = Buffer.alloc(Math.round(5.5 * 1024 * 1024), 1);
  const res3 = await upload(jar, "/studio/articles/new", UPLOAD_ACTION_ID, big, "big.png", "image/png");
  const rejected3 = res3.status === 200 && listUploads().size === before3.size;
  check("fichier > 5 Mo refusé (aucun fichier écrit)", rejected3, `status=${res3.status}`);

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("ECHEC du test : " + error.stack);
  process.exit(1);
});
