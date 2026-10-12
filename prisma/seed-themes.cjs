#!/usr/bin/env node
/**
 * Seed des thèmes éditoriaux — **production** (WP16a/WP20).
 *
 * Exécution : npm run db:seed:themes      (ou node prisma/seed-themes.cjs)
 *
 * Pourquoi un script séparé de `prisma/seed.cjs` :
 * `seed.cjs` crée (et réinitialise) un compte `admin@example.com` avec un mot de
 * passe connu, ce qui n'a rien à faire en production. Ce script-ci ne touche
 * **qu'à la table Theme** : aucun auteur ni mot de passe n'est modifié,
 * aucune ligne n'est supprimée. Les thèmes existants sont mis à jour par slug.
 *
 * Il est idempotent (clé = `slug`) : relançable sans créer de doublon. Il met à
 * jour nom, description, couleur, icône et `active`, ce qui permet aussi de
 * propager un changement de thème (désactivation de « Transferts » au WP20, par
 * exemple).
 *
 * Options :
 *   --dry-run   affiche ce qui serait fait, sans écrire
 *   --quiet     n'affiche que le bilan
 *
 * Cible : `DIRECT_URL` **si elle est renseignée**, sinon `DATABASE_URL` — la
 * même règle que `prisma.config.ts`, pour que `db:deploy` et `db:seed:themes`
 * visent toujours la même base. La chaîne directe est de toute façon préférable
 * ici (le pooler ne garantit pas les ordres de session, et ce script exécute
 * `SET TIME ZONE 'UTC'`). Les suites `scripts/check-*.cjs` restent, elles, sur
 * `DATABASE_URL` : elles écrivent des données de test et ne doivent jamais
 * viser une base distante par surprise.
 */

const { randomBytes } = require("node:crypto");

// Passerelle synchrone PostgreSQL du projet (mêmes requêtes que seed.cjs).
const Database = require("../scripts/lib/pg-sync.cjs");
const DEFAULT_THEMES = require("./default-themes.cjs");

const dryRun = process.argv.includes("--dry-run");
const quiet = process.argv.includes("--quiet");

/** Identifiant au format cuid v1, celui que Prisma utilise par défaut. */
function createCuid() {
  const timestamp = Date.now().toString(36);
  const counter = Math.floor(Math.random() * 1_679_616)
    .toString(36)
    .padStart(4, "0");
  const fingerprint = randomBytes(2).toString("hex").slice(0, 4);
  const random = randomBytes(4).toString("hex").slice(0, 8);
  return `c${timestamp}${counter}${fingerprint}${random}`;
}

/**
 * Chaîne visée : `DIRECT_URL` d'abord (comme la CLI Prisma), sinon
 * `DATABASE_URL`. `null` si aucune des deux n'est renseignée.
 */
function resolveTarget() {
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

/** Hôte et base visés, sans identifiants ni mot de passe (contrôle visuel). */
function describeTarget(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(URL illisible)";
  }
}

function main() {
  try {
    process.loadEnvFile?.();
  } catch {
    /* .env absent : tout doit venir de l'environnement du shell. */
  }

  const target = resolveTarget();
  if (!target) {
    console.error(
      'ECHEC | DIRECT_URL et DATABASE_URL sont absentes : renseignez-en une (PowerShell : $env:DIRECT_URL="postgresql://…").',
    );
    process.exitCode = 1;
    return;
  }

  const db = new Database(target.url);
  const created = [];
  const updated = [];

  console.log(
    `Cible : ${describeTarget(target.url)}  (source : ${target.source})${dryRun ? "  [mode --dry-run : aucune écriture]" : ""}`,
  );
  console.log(`Thèmes à appliquer : ${DEFAULT_THEMES.length}\n`);

  try {
    for (const theme of DEFAULT_THEMES) {
      const existing = db.prepare("SELECT id FROM Theme WHERE slug = ?").get(theme.slug);

      if (dryRun) {
        (existing ? updated : created).push(theme.slug);
        if (!quiet) {
          console.log(`${existing ? "mise à jour" : "création    "} | ${theme.slug} (${theme.name}${theme.active ? "" : ", désactivé"})`);
        }
        continue;
      }

      if (existing) {
        db.prepare(
          `UPDATE Theme
              SET name = ?, description = ?, color = ?, icon = ?, active = ?, "updatedAt" = CURRENT_TIMESTAMP
            WHERE slug = ?`,
        ).run(
          theme.name,
          theme.description,
          theme.color,
          theme.icon,
          theme.active ? 1 : 0,
          theme.slug,
        );
        updated.push(theme.slug);
        if (!quiet) console.log(`mise à jour | ${theme.slug} (${theme.name}${theme.active ? "" : ", désactivé"})`);
      } else {
        db.prepare(
          `INSERT INTO Theme (id, name, slug, description, color, icon, active, "createdAt", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        ).run(
          createCuid(),
          theme.name,
          theme.slug,
          theme.description,
          theme.color,
          theme.icon,
          theme.active ? 1 : 0,
        );
        created.push(theme.slug);
        if (!quiet) console.log(`création    | ${theme.slug} (${theme.name}${theme.active ? "" : ", désactivé"})`);
      }
    }

    const total = db.prepare("SELECT count(*) AS n FROM Theme").get().n;
    const active = db.prepare("SELECT count(*) AS n FROM Theme WHERE active = true").get().n;
    console.log(
      `\nBilan : ${created.length} création(s), ${updated.length} mise(s) à jour — ${total} thème(s) en base, ${active} actif(s).`,
    );
    if (dryRun) console.log("Mode --dry-run : rien n'a été écrit.");
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error("ECHEC du seed des thèmes : " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
