#!/usr/bin/env node
/**
 * Migration de la base PostgreSQL locale (conteneur Docker) vers Neon.
 *
 * La base de développement vit dans le conteneur `promptsport-pg`. Neon
 * n'expose pas de copie de fichier : la bascule se fait en trois temps, tous
 * exécutés par ce script :
 *
 *   1. `pg_dump --data-only --inserts` de la base locale (via `docker exec`) ;
 *   2. `prisma migrate deploy` sur la cible (le schéma doit exister avant les
 *      données) ;
 *   3. injection du dump avec psql en autocommit, puis vérification
 *      table par table des comptages source et cible.
 *
 * Sécurité — la cible n'est **jamais** déduite de `DIRECT_URL` ou de
 * `DATABASE_URL` : ces variables visent la base de développement (ou une base
 * distante déjà configurée), et une confusion écraserait la mauvaise base. La
 * cible vient obligatoirement de `--target` ou de `NEON_DIRECT_URL`. Le script
 * est en **simulation par défaut** : sans `--confirm`, il se contente de
 * vérifier la source, la cible et d'afficher le plan. Une cible locale
 * (localhost) est refusée, sauf `--allow-local-target` pour une répétition sur
 * une base de test ; une URL Neon « pooled » (`-pooler`) est refusée, car les
 * migrations ont besoin de la chaîne directe.
 *
 * Le dump exclut `_prisma_migrations` : la table de suivi est écrite par
 * `prisma migrate deploy`, pas recopiée depuis le poste. `--inserts` produit
 * du SQL lisible et portable, au prix d'un fichier plus volumineux ; les
 * données de ce projet (quelques milliers de lignes) restent modestes.
 *
 * Usage :
 *   node scripts/migrate-local-to-neon.cjs --target "postgresql://…@ep-….neon.tech/neondb?sslmode=require"
 *   NEON_DIRECT_URL="postgresql://…" node scripts/migrate-local-to-neon.cjs --confirm
 *   node scripts/migrate-local-to-neon.cjs --target "…" --confirm --truncate
 *
 * Options :
 *   --target <url>          cible Neon (chaîne directe, sans `-pooler`)
 *   --source <url>          base locale (défaut : promptsport sur localhost:5432)
 *   --container <nom>       conteneur Docker (défaut : promptsport-pg)
 *   --dump <chemin>         fichier SQL de sortie (défaut : backups/neon-data-<date>.sql)
 *   --confirm               exécute réellement (sinon simulation)
 *   --truncate              vide les tables de la cible avant l'injection
 *   --skip-migrations       ne lance pas `prisma migrate deploy`
 *   --allow-local-target    autorise une cible localhost (répétition seulement)
 *   --overwrite             remplace un dump existant
 *   --help, -h              affiche cette aide
 *
 * Variables :
 *   NEON_DIRECT_URL         cible par défaut, si `--target` est absent.
 *                           `DIRECT_URL` et `DATABASE_URL` ne sont jamais lus.
 *
 * Prérequis : Docker en marche, conteneur `promptsport-pg` démarré (pg_dump et
 * psql y sont présents), `node_modules` installé (CLI Prisma et paquet `pg`).
 * Le conteneur doit pouvoir joindre Neon (sortie HTTPS/5432 autorisée).
 *
 * En cas d'échec, les lignes déjà importées restent présentes. Les triggers
 * utilisateur sont réactivés avant de sortir. Corriger puis relancer avec
 * `--truncate` (les migrations déjà appliquées sont ignorées par Prisma).
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { Client } = require("pg");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_SOURCE =
  "postgresql://promptsport:promptsport@localhost:5432/promptsport?schema=public";
const DEFAULT_CONTAINER = "promptsport-pg";
const PRISMA_ENTRY = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const MIGRATIONS_DIR = path.join(ROOT, "prisma", "migrations");
const EXCLUDED_TABLE = "_prisma_migrations";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);

function usage() {
  const header = fs
    .readFileSync(__filename, "utf8")
    .split("*/")[0]
    .replace(/^#!.*\n/, "")
    .replace(/^\/\*\*\n?/, "")
    .split("\n")
    .map((line) => line.replace(/^ \* ?/, ""))
    .join("\n");
  console.log(header.trim());
}

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    target: process.env.NEON_DIRECT_URL?.trim() || "",
    source: DEFAULT_SOURCE,
    container: DEFAULT_CONTAINER,
    dump: "",
    confirm: false,
    truncate: false,
    skipMigrations: false,
    allowLocalTarget: false,
    overwrite: false,
    help: false,
  };

  const valueOptions = new Set(["target", "source", "container", "dump"]);
  const flagOptions = new Map([
    ["--confirm", "confirm"],
    ["--truncate", "truncate"],
    ["--skip-migrations", "skipMigrations"],
    ["--allow-local-target", "allowLocalTarget"],
    ["--overwrite", "overwrite"],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    let argument = argv[index];
    let inlineValue;

    if (argument.startsWith("--") && argument.includes("=")) {
      const equals = argument.indexOf("=");
      inlineValue = argument.slice(equals + 1);
      argument = argument.slice(0, equals);
    }

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (flagOptions.has(argument)) {
      if (inlineValue !== undefined) {
        fail(`l'option ${argument} ne prend pas de valeur`);
      }
      options[flagOptions.get(argument)] = true;
      continue;
    }

    const name = argument.replace(/^--/, "");
    if (valueOptions.has(name)) {
      const value = inlineValue !== undefined ? inlineValue : argv[++index];
      if (!value || value.startsWith("--")) {
        fail(`l'option ${argument} attend une valeur`);
      }
      options[name] = value.trim();
      continue;
    }

    fail(`argument inconnu : ${argument} (voir --help)`);
  }

  return options;
}

function parsePostgresUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${label} : URL invalide`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    fail(
      `${label} : protocole « ${url.protocol} » refusé. Utiliser une URL PostgreSQL TCP ` +
        "(postgres:// ou postgresql://), pas prisma+postgres://.",
    );
  }
  if (!url.hostname) {
    fail(`${label} : hôte manquant`);
  }
  if (!url.pathname || url.pathname === "/") {
    fail(`${label} : nom de base manquant`);
  }

  return url;
}

/**
 * Variables d'environnement libpq correspondant à une URL.
 *
 * `PGDATABASE` n'accepte pas une URL de connexion complète : on décompose donc
 * l'URL en variables séparées. Le mot de passe ne figure jamais dans la ligne
 * de commande (`docker exec -e` le reprend de l'environnement du client), et
 * les paramètres propres à Prisma (`schema`, `connection_limit`…) sont ignorés.
 */
function pgEnv(raw) {
  const url = new URL(raw);
  const env = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };

  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);

  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  const connectTimeout = url.searchParams.get("connect_timeout");
  if (connectTimeout) env.PGCONNECT_TIMEOUT = connectTimeout;

  return env;
}

function describe(url) {
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

function sameDatabase(a, b) {
  return (
    a.hostname === b.hostname &&
    (a.port || "5432") === (b.port || "5432") &&
    a.pathname === b.pathname
  );
}

function formatRows(value) {
  return Number(value).toLocaleString("fr-FR");
}

function runSync(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
  if (result.error) {
    fail(`${command} n'a pas pu être lancé : ${result.error.message}`);
  }
  return result;
}

/** `docker exec` synchrone ; `env` est transmis par nom (`-e VAR`), jamais en argument. */
function dockerExecSync(container, args, options = {}) {
  const env = options.env ?? {};
  const argsWithEnv = [];
  for (const key of Object.keys(env)) {
    argsWithEnv.push("-e", key);
  }
  return runSync(
    "docker",
    ["exec", ...argsWithEnv, container, ...args],
    { env: { ...process.env, ...env } },
  );
}

function checkDocker(container) {
  const inspect = runSync("docker", ["inspect", "-f", "{{.State.Running}}", container]);
  if (inspect.status !== 0) {
    fail(
      `conteneur « ${container} » introuvable. Démarrer la base locale :\n` +
        "  docker start promptsport-pg",
    );
  }
  if (inspect.stdout.trim() !== "true") {
    fail(`conteneur « ${container} » arrêté. Le démarrer : docker start ${container}`);
  }

  const dumpVersion = dockerExecSync(container, ["pg_dump", "--version"]);
  const psqlVersion = dockerExecSync(container, ["psql", "--version"]);
  if (dumpVersion.status !== 0 || psqlVersion.status !== 0) {
    fail(`pg_dump et psql doivent être installés dans le conteneur « ${container} »`);
  }

  return {
    pgDump: dumpVersion.stdout.trim(),
    psql: psqlVersion.stdout.trim(),
  };
}

function checkSource(container, source) {
  const result = dockerExecSync(
    container,
    ["psql", "--no-psqlrc", "-t", "-A", "-c", "SELECT current_database(), current_user"],
    { env: pgEnv(source) },
  );

  if (result.status !== 0) {
    fail(
      `connexion à la base locale impossible :\n${result.stderr.trim() || "(sans détail)"}`,
    );
  }

  const [database, user] = result.stdout.trim().split("|");
  return { database, user };
}

function listSourceTables(container, source) {
  const result = dockerExecSync(
    container,
    [
      "psql",
      "--no-psqlrc",
      "-t",
      "-A",
      "-c",
      "SELECT table_name FROM information_schema.tables " +
        "WHERE table_schema = 'public' AND table_type = 'BASE TABLE' " +
        "ORDER BY table_name",
    ],
    { env: pgEnv(source) },
  );

  if (result.status !== 0) {
    fail(`lecture du catalogue local impossible :\n${result.stderr.trim()}`);
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Nom qualifié : le dump remet `search_path` à vide, il faut donc `public.` explicitement. */
function qualifiedName(table) {
  return `public.${quoteIdentifier(table)}`;
}

function countsQuery(tables) {
  return tables
    .map(
      (table) =>
        `SELECT '${table.replace(/'/g, "''")}' AS table_name, ` +
        `count(*)::bigint AS rows FROM ${qualifiedName(table)}`,
    )
    .join(" UNION ALL ");
}

function parseCounts(output) {
  const counts = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [table, rows] = line.split("\t");
    counts.set(table, Number(rows));
  }
  return counts;
}

function sourceCounts(container, source, tables) {
  const result = dockerExecSync(
    container,
    [
      "psql",
      "--no-psqlrc",
      "-t",
      "-A",
      "-F",
      "\t",
      "-c",
      countsQuery(tables),
    ],
    { env: pgEnv(source) },
  );

  if (result.status !== 0) {
    fail(`comptage de la base locale impossible :\n${result.stderr.trim()}`);
  }

  return parseCounts(result.stdout);
}

async function connectTarget(target) {
  const client = new Client({
    connectionString: target.toString(),
    application_name: "promptsport-migrate-neon",
    connectionTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30_000,
  });
  // A serverless endpoint may close this inspection connection during the dump.
  // Reconnect before verification rather than crashing on an idle client error.
  client.on("error", () => {});
  await client.connect();
  return client;
}

async function targetTables(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

async function targetCounts(client, tables) {
  const { rows } = await client.query(countsQuery(tables));
  return new Map(rows.map((row) => [row.table_name, Number(row.rows)]));
}

/** Tables portant au moins un trigger utilisateur (hors contraintes internes). */
async function targetTriggerTables(client) {
  const { rows } = await client.query(
    `SELECT DISTINCT c.relname AS table_name
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public'
     ORDER BY c.relname`,
  );
  return rows.map((row) => row.table_name);
}

async function targetMigrationNames(client) {
  try {
    const { rows } = await client.query(
      `SELECT migration_name FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
       ORDER BY migration_name`,
    );
    return new Set(rows.map((row) => row.migration_name));
  } catch (error) {
    if (error.code === "42P01") {
      return new Set();
    }
    throw error;
  }
}

function localMigrationNames() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function dumpSource({ container, source, destination }) {
  return new Promise((resolve, reject) => {
    const partial = `${destination}.partial`;
    const output = fs.createWriteStream(partial);
    const child = spawn(
      "docker",
      [
        "exec",
        ...Object.keys(pgEnv(source)).flatMap((key) => ["-e", key]),
        container,
        "pg_dump",
        "--data-only",
        "--inserts",
        "--no-owner",
        "--no-privileges",
        `--exclude-table=public.${EXCLUDED_TABLE}`,
      ],
      {
        env: { ...process.env, ...pgEnv(source) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.pipe(output);

    child.on("error", (error) => {
      output.destroy();
      reject(error);
    });

    output.on("error", (error) => {
      child.kill();
      reject(error);
    });

    child.on("close", (code) => {
      output.end(() => {
        if (code !== 0) {
          fs.rmSync(partial, { force: true });
          reject(
            new Error(
              `pg_dump a échoué (code ${code}) :\n${stderr.trim() || "(sans détail)"}`,
            ),
          );
          return;
        }
        fs.renameSync(partial, destination);
        resolve(fs.statSync(destination).size);
      });
    });
  });
}

async function runPrismaMigrate(target) {
  if (!fs.existsSync(PRISMA_ENTRY)) {
    fail("CLI Prisma introuvable. Lancer `npm install` à la racine du projet.");
  }

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [PRISMA_ENTRY, "migrate", "deploy"], {
      cwd: ROOT,
      env: {
        ...process.env,
        // Prisma lit DIRECT_URL en priorité : les deux pointent vers la cible.
        // process.loadEnvFile() ne remplace pas une variable déjà définie.
        DATABASE_URL: target,
        DIRECT_URL: target,
        CHECKPOINT_DISABLE: "1",
        PRISMA_HIDE_UPDATE_MESSAGE: "1",
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });

  if (result !== 0) {
    fail("`prisma migrate deploy` a échoué ; aucune donnée n'a été injectée.");
  }
}

/**
 * En-tête SQL injecté avant le dump.
 *
 * Les triggers **utilisateur** sont désactivés le temps du chargement
 * (`DISABLE TRIGGER USER`), pas les triggers internes : les clés étrangères
 * restent donc vérifiées. Deux raisons :
 *
 *  - `sync_club_rivalries` (migration 20261016210000) refuse un club rival dont
 *    la ligne `Team` n'est pas encore insérée ; pg_dump livre les tables une par
 *    une, donc la contrainte ne peut pas être satisfaite en cours de route ;
 *  - `article_search_vector_trigger` et `reader_competition_follows_update`
 *    recalculeraient des colonnes déjà présentes dans le dump.
 *
 * Les triggers sont réactivés en fin d'import et dans le chemin d'erreur.
 * `statement_timeout = 0` évite qu'un dump volumineux dépasse
 * la limite par défaut de Neon.
 */
function injectionPreamble(triggerTables) {
  const statements = [
    "SET statement_timeout = 0;",
    "SET client_encoding = 'UTF8';",
    "SET search_path = public;",
  ];

  for (const table of triggerTables) {
    statements.push(`ALTER TABLE ${qualifiedName(table)} DISABLE TRIGGER USER;`);
  }

  statements.push("");
  return statements.join("\n");
}

function injectionEpilogue(triggerTables) {
  return triggerTables
    .map((table) => `ALTER TABLE ${qualifiedName(table)} ENABLE TRIGGER USER;`)
    .join("\n");
}

function injectDump({ container, target, dumpPath, triggerTables }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        ...Object.keys(pgEnv(target)).flatMap((key) => ["-e", key]),
        container,
        "psql",
        "--no-psqlrc",
        // libpq defaults still come from PGHOST/PGDATABASE/PGPASSWORD. These
        // non-secret options must be passed explicitly: pgEnv splits the URL.
        "--dbname",
        "keepalives=1 keepalives_idle=30 connect_timeout=30",
        "--set",
        "ON_ERROR_STOP=1",
        "--quiet",
        "--output",
        "/dev/null",
      ],
      {
        env: { ...process.env, ...pgEnv(target) },
        stdio: ["pipe", "inherit", "inherit"],
      },
    );

    child.stdin.write(injectionPreamble(triggerTables));

    const input = fs.createReadStream(dumpPath);
    child.stdin.on("error", (error) => {
      input.destroy();
      reject(error);
    });
    input.on("error", (error) => {
      child.kill();
      reject(error);
    });
    input.pipe(child.stdin, { end: false });
    input.on("end", () => {
      child.stdin.end(`${injectionEpilogue(triggerTables)}\n`);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      input.destroy();
      if (code !== 0) {
        reject(
          new Error(
            `psql a échoué (code ${code}). L'import est partiel : ` +
              "les lignes déjà validées restent présentes. Relancer sur une cible vide ou avec --truncate.",
          ),
        );
        return;
      }
      resolve();
    });
  });
}

function printPlan({ options, source, target, sourceInfo, targetInfo, dumpPath, docker }) {
  console.log("");
  console.log("Migration PostgreSQL local → Neon");
  console.log("---------------------------------");
  console.log(`Source      : ${describe(source)} (${sourceInfo.database}, rôle ${sourceInfo.user})`);
  console.log(`Cible       : ${describe(target)}`);
  console.log(`Conteneur   : ${options.container} — ${docker.pgDump}`);
  console.log(`Dump        : ${path.relative(ROOT, dumpPath)}`);
  console.log(`Migrations  : ${options.skipMigrations ? "ignorées (--skip-migrations)" : "prisma migrate deploy"}`);
  console.log(`État cible  : ${targetInfo}`);
  console.log(`Mode        : ${options.confirm ? "ÉCRITURE (--confirm)" : "SIMULATION"}`);
  console.log("");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return;
  }

  if (!options.target) {
    fail(
      "cible absente. Fournir --target <url> ou NEON_DIRECT_URL (chaîne directe Neon).\n" +
        "DIRECT_URL et DATABASE_URL du fichier .env ne sont volontairement jamais utilisés.",
    );
  }

  const source = parsePostgresUrl(options.source, "--source");
  const target = parsePostgresUrl(options.target, "--target");
  target.searchParams.set("keepalives", "1");
  target.searchParams.set("keepalives_idle", "30");
  target.searchParams.set("connect_timeout", "30");
  options.target = target.toString();

  if (target.hostname.includes("-pooler")) {
    fail(
      "la cible est une URL Neon « pooled » (-pooler). Les migrations ont besoin de la " +
        "chaîne directe : dans la console Neon, choisir « Direct connection ».",
    );
  }

  if (sameDatabase(source, target)) {
    fail("la cible est identique à la source : la migration écraserait la base locale.");
  }

  const targetIsLocal = LOCAL_HOSTS.has(target.hostname);
  if (targetIsLocal && !options.allowLocalTarget) {
    fail(
      `la cible ${target.hostname} est locale. Pour une répétition sur une base de test, ` +
        "ajouter --allow-local-target ; pour la production, viser un hôte Neon.",
    );
  }

  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const dumpPath = path.resolve(
    ROOT,
    options.dump || path.join("backups", `neon-data-${timestamp}.sql`),
  );

  if (options.confirm && fs.existsSync(dumpPath) && !options.overwrite) {
    fail(`le dump ${dumpPath} existe déjà ; ajouter --overwrite ou choisir --dump <chemin>.`);
  }

  console.log("Vérification de l'environnement…");
  const docker = checkDocker(options.container);
  const sourceInfo = checkSource(options.container, options.source);
  const tables = listSourceTables(options.container, options.source).filter(
    (table) => table !== EXCLUDED_TABLE,
  );

  if (tables.length === 0) {
    fail("aucune table publique dans la base locale : rien à migrer.");
  }

  const localMigrations = localMigrationNames();

  let client;
  let targetSummary;
  let targetIsEmpty = true;

  try {
    client = await connectTarget(options.target);
    const existingTables = await targetTables(client);
    const existingCounts = await targetCounts(
      client,
      existingTables.filter((table) => table !== EXCLUDED_TABLE),
    );
    const existingRows = [...existingCounts.values()].reduce((sum, value) => sum + value, 0);
    targetIsEmpty = existingRows === 0;

    const missingTables = tables.filter((table) => !existingTables.includes(table));
    const applied = await targetMigrationNames(client);
    const pending = localMigrations.filter((name) => !applied.has(name));

    targetSummary = targetIsEmpty
      ? `vide (${existingTables.length} table(s))`
      : `${formatRows(existingRows)} ligne(s) déjà présentes dans ${existingTables.length} table(s)`;

    printPlan({
      options,
      source,
      target,
      sourceInfo,
      targetInfo: targetSummary,
      dumpPath,
      docker,
    });

    if (pending.length > 0) {
      console.log(`Migrations en attente sur la cible : ${pending.length}`);
      for (const name of pending) {
        console.log(`  - ${name}`);
      }
      console.log("");
    }
    if (missingTables.length > 0) {
      console.log(
        `Tables absentes de la cible (les migrations les créeront) : ${missingTables.join(", ")}`,
      );
      console.log("");
    }

    if (!options.confirm) {
      console.log("SIMULATION — aucune écriture effectuée.");
      console.log("Relancer avec --confirm pour appliquer la migration.");
      return;
    }

    if (!targetIsEmpty && !options.truncate) {
      fail(
        `la cible contient déjà ${formatRows(existingRows)} ligne(s). ` +
          "Relancer avec --truncate pour la vider avant l'injection, ou choisir une base vide.",
      );
    }

    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });

    console.log("1/4 — Dump des données locales…");
    const bytes = await dumpSource({
      container: options.container,
      source: options.source,
      destination: dumpPath,
    });
    console.log(`      ${path.relative(ROOT, dumpPath)} (${(bytes / 1024 / 1024).toFixed(1)} Mio)`);

    if (!options.skipMigrations) {
      console.log("2/4 — Application des migrations Prisma sur la cible…");
      await runPrismaMigrate(options.target);
    } else {
      console.log("2/4 — Migrations ignorées (--skip-migrations).");
    }

    if (options.truncate) {
      const tablesToTruncate = (await targetTables(client)).filter(
        (table) => table !== EXCLUDED_TABLE,
      );
      if (tablesToTruncate.length > 0) {
        console.log(`3/4 — Vidage de ${tablesToTruncate.length} table(s) cible…`);
        await client.query(
          `TRUNCATE TABLE ${tablesToTruncate.map(qualifiedName).join(", ")} ` +
            "RESTART IDENTITY CASCADE",
        );
      }
    } else {
      console.log("3/4 — Cible vide : aucun vidage nécessaire.");
    }

    console.log("4/4 — Injection des données (autocommit, sans transaction globale)…");
    const triggerTables = await targetTriggerTables(client);
    if (triggerTables.length > 0) {
      console.log(
        `      triggers utilisateur suspendus : ${triggerTables.join(", ")}`,
      );
    }
    try {
      await injectDump({ container: options.container, target: options.target, dumpPath, triggerTables });
    } catch (error) {
      const cleanup = await connectTarget(options.target);
      try {
        for (const table of triggerTables) await cleanup.query(`ALTER TABLE ${qualifiedName(table)} ENABLE TRIGGER USER`);
      } finally { await cleanup.end(); }
      throw error;
    }

    await client.end().catch(() => {});
    client = await connectTarget(options.target);

    console.log("");
    console.log("Vérification des comptages…");
    const expected = sourceCounts(options.container, options.source, tables);
    const actual = await targetCounts(client, tables);

    const mismatches = [];
    let totalRows = 0;
    for (const table of tables) {
      const wanted = expected.get(table) ?? 0;
      const found = actual.get(table) ?? 0;
      totalRows += wanted;
      if (wanted !== found) {
        mismatches.push(`${table} : source ${formatRows(wanted)}, cible ${formatRows(found)}`);
      }
    }

    if (mismatches.length > 0) {
      fail(
        `comptages différents après injection :\n  ${mismatches.join("\n  ")}\n` +
          `Le dump est conservé : ${dumpPath}`,
      );
    }

    const appliedAfter = await targetMigrationNames(client);
    const missingMigrations = localMigrations.filter((name) => !appliedAfter.has(name));
    if (missingMigrations.length > 0) {
      fail(
        "migrations absentes de la cible :\n  " +
          missingMigrations.join("\n  ") +
          "\nRelancer sans --skip-migrations.",
      );
    }

    console.log(
      `OK | ${tables.length} table(s), ${formatRows(totalRows)} ligne(s) vérifiées, ` +
        `${appliedAfter.size} migration(s) appliquée(s).`,
    );
    console.log(`Dump conservé : ${path.relative(ROOT, dumpPath)}`);
    console.log("");
    console.log("Étapes suivantes :");
    console.log("  1. renseigner DATABASE_URL (pooled) et DIRECT_URL (direct) sur Vercel ;");
    console.log("  2. redéployer, puis vérifier /scores, /themes et un article ;");
    console.log("  3. lancer `node scripts/check-prisma-postgres.cjs <url-directe>`.");
  } finally {
    await client?.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error("");
  console.error(`ECHEC | ${error.message}`);
  process.exitCode = 1;
});
