/**
 * Lance Prisma Studio sur la base de développement.
 *
 * Pourquoi ce script existe (contrainte Prisma 7) :
 *   - le moteur de migration exige la forme « file:./prisma/dev.db » ;
 *   - le nouveau Prisma Studio déduit le protocole avec url.split("://")[0],
 *     donc il exige la forme « file://... ».
 * Aucune URL unique ne satisfait les deux. Ce script lit DATABASE_URL (source
 * de vérité : .env) et la convertit vers une URL « file:// » absolue, sans
 * jamais coder de chemin machine en dur.
 *
 * Usage : npm run db:studio
 */
const { readFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const path = require("node:path");

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  try {
    const contents = readFileSync(path.resolve(".env"), "utf8");
    const match = contents.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

const databaseUrl = readDatabaseUrl();
if (!databaseUrl) {
  console.error(
    'ECHEC: DATABASE_URL introuvable. Créez .env avec : DATABASE_URL="file:./prisma/dev.db"',
  );
  process.exit(1);
}

// « file:./prisma/dev.db » -> « file:///C:/.../prisma/dev.db »
const rawPath = databaseUrl.replace(/^file:(\/\/)?/, "");
const absolutePath = path.resolve(rawPath).split(path.sep).join("/");
const studioUrl = `file:///${absolutePath.replace(/^\//, "")}`;

console.log(`Base : ${path.resolve(rawPath)}`);
console.log(`URL transmise à Studio : ${studioUrl}`);

const port = process.env.STUDIO_PORT || "5555";

/**
 * On invoque le CLI Prisma directement avec l'exécutable Node courant.
 * Passer par « npx » échouerait ici : depuis Node 24 sur Windows, lancer un
 * fichier .cmd sans shell lève spawn EINVAL, et passer par un shell
 * complexifierait inutilement le quoting de l'URL.
 */
const prismaCli = require.resolve("prisma/build/index.js");

const child = spawn(
  process.execPath,
  [prismaCli, "studio", "--port", port, "--url", studioUrl],
  {
    stdio: "inherit",
    env: { ...process.env, BROWSER: process.env.BROWSER || "none" },
  },
);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (error) => {
  console.error("ECHEC du lancement de Prisma Studio : " + error.message);
  process.exit(1);
});
