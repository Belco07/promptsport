#!/usr/bin/env node
/**
 * Préflight Prisma Postgres (ou tout PostgreSQL TCP) — à lancer **avant**
 * `npm run db:deploy` puis `npm run db:seed:themes`.
 *
 * Pourquoi : sur une base distante, une migration qui échoue au milieu d'un
 * déploiement coûte cher (migration marquée « failed », `migrate resolve` à
 * jouer à la main). Ce contrôle vérifie en quelques secondes que la chaîne de
 * connexion est la bonne, que le serveur répond, que le schéma est à jour et
 * que l'extension `pg_trgm` — requise par la migration
 * `20261008160000_article_search` — est disponible et créable.
 *
 * Usage :
 *   node scripts/check-prisma-postgres.cjs                  # DIRECT_URL, sinon DATABASE_URL
 *   node scripts/check-prisma-postgres.cjs "postgres://…"    # URL explicite
 *
 * Options :
 *   --no-extension   ne pas tenter la création de `pg_trgm` (même annulée)
 *
 * La seule écriture possible est l'essai de création de l'extension, exécuté
 * dans une transaction **annulée** (`BEGIN … ROLLBACK`) : la base n'est jamais
 * modifiée. Tout le reste est en lecture seule.
 *
 * Le chiffrement est constaté **côté client**, sur le socket réellement utilisé
 * par `pg` (voir `probeTls`) : `pg_stat_ssl` décrit le lien interne du frontal
 * de Prisma Postgres et répond `ssl = false` alors que la connexion du client
 * est bien chiffrée. Cette sonde ouvre une connexion courte supplémentaire.
 *
 * Sortie : `OK | …`, `ECHEC | …`, `ATTENTION | …` (avis non bloquant) puis
 * `RESULTAT: n/N`. Code de sortie 1 dès qu'un contrôle échoue.
 */

const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");

const { Client } = require("pg");

const Database = require("./lib/pg-sync.cjs");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations");
const SKIP_EXTENSION = process.argv.includes("--no-extension");
const EXPLICIT_URL = process.argv.slice(2).find((argument) => !argument.startsWith("--"));

let passed = 0;
let failed = 0;

function pass(label) {
  passed += 1;
  console.log(`OK | ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.log(`ECHEC | ${label}${detail ? ` — ${detail}` : ""}`);
}

function warn(label) {
  console.log(`ATTENTION | ${label}`);
}

/** Hôte, port et base — jamais les identifiants. */
function describe(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(URL illisible)";
  }
}

/**
 * Base locale (conteneur Docker de développement) : TLS et `sslmode` n'y sont
 * pas exigés, sinon le préflight signalerait un faux bloquant sur le poste.
 */
function isLocalHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "host.docker.internal" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

/**
 * État du chiffrement **tel que le voit le client**.
 *
 * `pg_stat_ssl` ne convient pas ici : le frontal de Prisma Postgres termine le
 * TLS côté client puis se reconnecte au serveur PostgreSQL en interne, si bien
 * que la vue décrit ce lien interne et répond `ssl = false` alors que la
 * connexion applicative est parfaitement chiffrée (faux négatif constaté).
 * On inspecte donc le socket réellement utilisé par `pg` — un `TLSSocket` dès
 * que `sslmode` demande le chiffrement : `sslmode=require` étant traité comme
 * `verify-full` par pg 8.23, le certificat du serveur est en plus vérifié.
 *
 * Une connexion courte et dédiée est ouverte pour cette sonde, puis fermée.
 */
async function probeTls(url) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    const stream = client.connection?.stream;
    // Check the negotiated transport, not merely the requested ssl option.
    const encrypted = Boolean(stream && stream.encrypted === true && stream instanceof tls.TLSSocket);
    if (!encrypted) {
      return { encrypted: false };
    }
    const cipher = typeof stream.getCipher === "function" ? stream.getCipher() : null;
    const peer = typeof stream.getPeerCertificate === "function" ? stream.getPeerCertificate() : null;
    return {
      encrypted: true,
      protocol: stream.getProtocol(),
      cipher: cipher ? `${cipher.name} / ${cipher.version}` : null,
      // `authorized` est vrai quand la chaîne de certification a été validée.
      verified: stream.authorized === true,
      subject: peer?.subject?.CN || null,
    };
  } finally {
    try {
      await client.end();
    } catch {
      // Connexion déjà rompue (échec de `connect`) : rien à fermer.
    }
  }
}

/** DIRECT_URL d'abord (comme prisma.config.ts), puis DATABASE_URL. */
function pickUrl() {
  if (EXPLICIT_URL) {
    return { url: EXPLICIT_URL, source: "argument de la ligne de commande" };
  }
  const direct = process.env.DIRECT_URL?.trim();
  if (direct) {
    return { url: direct, source: "DIRECT_URL" };
  }
  const pooled = process.env.DATABASE_URL?.trim();
  if (pooled) {
    return { url: pooled, source: "DATABASE_URL" };
  }
  return null;
}
/** Dossiers de migration présents dans le dépôt. */
function localMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Migrations déjà appliquées (table `_prisma_migrations`). null si absente. */
function appliedMigrations(db) {
  try {
    const rows = db
      .prepare(
        `SELECT migration_name AS name FROM _prisma_migrations
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      )
      .all();
    return new Set(rows.map((row) => row.name));
  } catch {
    return null;
  }
}

/**
 * Vérifie que `pg_trgm` peut être créée par l'utilisateur courant.
 *
 * `CREATE EXTENSION` est transactionnel sous PostgreSQL : l'essai est donc
 * annulé, y compris en cas d'échec (le `ROLLBACK` libère la transaction avortée
 * pour que les requêtes suivantes restent utilisables).
 */
function probeExtension(db) {
  try {
    db.exec("BEGIN;\nCREATE EXTENSION IF NOT EXISTS pg_trgm;\nROLLBACK;\n");
    pass("extension pg_trgm : création possible (essai annulé, rien n'est conservé)");
  } catch (error) {
    try {
      db.exec("ROLLBACK;\n");
    } catch {
      // La transaction est peut-être déjà terminée : sans conséquence.
    }
    fail(
      "extension pg_trgm : création impossible",
      `${error.message} — la migration 20261008160000_article_search échouera ; ` +
        "faites activer pg_trgm auprès de l'hébergeur avant de poursuivre ; " +
        "retirer uniquement l'index ne corrige pas l'indisponibilité de l'extension.",
    );
  }
}

async function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    // .env absent : tout doit venir de l'environnement du shell.
  }

  const picked = pickUrl();
  if (!picked) {
    fail(
      "chaîne de connexion introuvable",
      "renseignez DIRECT_URL (ou DATABASE_URL), ou passez l'URL en argument",
    );
    console.log(`\nRESULTAT: ${passed}/${passed + failed}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Cible : ${describe(picked.url)}  (source : ${picked.source})\n`);

  if (/^prisma\+postgres:\/\//i.test(picked.url.trim())) {
    fail(
      "schéma d'URL refusé",
      "`prisma+postgres://` n'est pas du PostgreSQL TCP : utilisez la chaîne directe " +
        "« postgres://…@db.prisma.io:5432/postgres?sslmode=require »",
    );
    console.log(`\nRESULTAT: ${passed}/${passed + failed}`);
    process.exitCode = 1;
    return;
  }

  if (!/^postgres(ql)?:\/\//.test(picked.url.trim())) {
    fail("schéma d'URL inattendu", "attendu : postgres:// ou postgresql://");
    console.log(`\nRESULTAT: ${passed}/${passed + failed}`);
    process.exitCode = 1;
    return;
  }

  const localHost = isLocalHost(picked.url);
  if (!localHost && !/sslmode=require/.test(picked.url)) {
    warn("l'URL ne contient pas `?sslmode=require` : Prisma Postgres exige TLS");
  }
  if (/pooled\./.test(picked.url)) {
    warn(
      "chaîne pooled détectée : les commandes de migration et le seed des thèmes exécutent des " +
        "ordres de session (verrous, `SET TIME ZONE 'UTC'`) que le pooler ne garantit pas — utilisez DIRECT_URL",
    );
  }

  let db;
  try {
    db = new Database(picked.url);
  } catch (error) {
    fail("connexion impossible", error.message);
    console.log(`\nRESULTAT: ${passed}/${passed + failed}`);
    process.exitCode = 1;
    return;
  }

  try {
    const version = db.prepare("SELECT version() AS v").get().v;
    pass(`serveur joint : ${String(version).split(" on ")[0]}`);

    try {
      const state = await probeTls(picked.url);
      if (state.encrypted) {
        const details = [
          state.protocol,
          state.cipher,
          state.subject ? `certificat « ${state.subject} »` : null,
          state.verified ? "chaîne vérifiée" : "chaîne non vérifiée",
        ].filter(Boolean);
        pass(`connexion chiffrée (TLS actif : ${details.join(", ")})`);
        // Diagnostic utile : derrière le frontal de Prisma Postgres, la vue
        // serveur décrit le lien interne et contredit le constat du client.
        try {
          const backend = db
            .prepare("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
            .get();
          if (backend && backend.ssl !== 1 && backend.ssl !== true) {
            warn(
              "pg_stat_ssl répond « non chiffré » côté serveur : attendu derrière le frontal " +
                "de Prisma Postgres, qui termine le TLS puis se reconnecte en interne",
            );
          }
        } catch {
          // Vue indisponible : sans conséquence sur le verdict.
        }
      } else if (localHost) {
        warn("connexion non chiffrée — normal sur une base locale de développement");
      } else {
        fail(
          "connexion non chiffrée",
          "TLS attendu sur Prisma Postgres : vérifiez que l'URL contient bien `?sslmode=require`",
        );
      }
    } catch (error) {
      if (localHost) {
        warn(`état TLS illisible (${error.message})`);
      } else {
        fail("état TLS non vérifiable", error.message);
      }
    }

    const identity = db
      .prepare("SELECT current_database() AS base, current_user AS utilisateur, current_schema() AS schema")
      .get();
    pass(`base « ${identity.base} », utilisateur « ${identity.utilisateur} », schéma « ${identity.schema} »`);
    if (identity.schema !== "public") {
      warn(
        `le schéma courant n'est pas « public » : ajoutez « ?schema=public » à l'URL si les tables y sont`,
      );
    }

    const localMigrationsList = localMigrations();
    const applied = appliedMigrations(db);
    if (applied === null) {
      warn(
        `table _prisma_migrations absente : les ${localMigrationsList.length} migrations sont à appliquer ` +
          "(base neuve ou non migrée)",
      );
    } else {
      const pending = localMigrationsList.filter((name) => !applied.has(name));
      if (pending.length === 0) {
        pass(`migrations : ${localMigrationsList.length} appliquées, aucune en attente`);
      } else {
        const preview = pending.slice(0, 3).join(", ");
        warn(
          `migrations en attente : ${pending.length} (${preview}${pending.length > 3 ? ", …" : ""}) — ` +
            "lancez `npm run db:deploy`",
        );
      }
    }

    try {
      const themes = db.prepare("SELECT count(*) AS n FROM Theme").get().n;
      if (themes === 0) {
        warn("table Theme présente mais vide : lancez `npm run db:seed:themes`");
      } else {
        const active = db.prepare("SELECT count(*) AS n FROM Theme WHERE active = true").get().n;
        pass(`thèmes : ${themes} en base, ${active} actif(s)`);
      }
    } catch {
      warn("table Theme absente : normal avant `npm run db:deploy` (puis `db:seed:themes`)");
    }

    let pgTrgmAvailable = null;
    try {
      pgTrgmAvailable = db
        .prepare(
          "SELECT default_version AS version, installed_version AS installed FROM pg_available_extensions WHERE name = ?",
        )
        .get("pg_trgm");
    } catch (error) {
      warn(`catalogue des extensions illisible (${error.message})`);
    }

    if (pgTrgmAvailable === null) {
      warn("pg_trgm : disponibilité inconnue (catalogue illisible)");
    } else if (!pgTrgmAvailable) {
      fail(
        "pg_trgm indisponible sur cette instance",
        "le support des extensions Prisma Postgres est en accès anticipé " +
          "(offres Pro/Business, ou Free/Starter créées après le 12/08/2025)",
      );
    } else if (pgTrgmAvailable.installed) {
      pass(`extension pg_trgm déjà installée (v${pgTrgmAvailable.installed})`);
    } else if (SKIP_EXTENSION) {
      warn(`pg_trgm disponible (v${pgTrgmAvailable.version}) mais non installée — essai ignoré (--no-extension)`);
    } else {
      probeExtension(db);
    }
  } finally {
    db.close();
  }

  const total = passed + failed;
  console.log(`\nRESULTAT: ${passed}/${total}`);
  if (failed === 0) {
    console.log("Base prête : `npm run db:deploy` puis `npm run db:seed:themes`.");
  } else {
    console.log("Corrigez les échecs ci-dessus avant de lancer `npm run db:deploy`.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`ECHEC du préflight : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
