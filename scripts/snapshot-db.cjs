/**
 * Instantané logique de la base PostgreSQL (WP12a).
 *
 * SQLite proposait `VACUUM INTO` pour copier le fichier de base en un instant
 * cohérent. PostgreSQL ne fonctionne pas ainsi : la sauvegarde de référence est
 * `pg_dump` (copie logique) ou `pg_basebackup` (copie physique). Ce script
 * produit à la place un export JSON de toutes les tables : lisible, portable, et
 * suffisant pour garder une trace avant une opération risquée (migration,
 * réinitialisation) sur un poste de développement.
 *
 * Pour une sauvegarde exploitable ailleurs :
 *   pg_dump --format=custom "$DATABASE_URL" > sauvegarde.dump
 *
 * Usage : node scripts/snapshot-db.cjs backups/pg-snapshot-<date>.json
 */
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const path = require("node:path");
const { mkdirSync, writeFileSync, statSync } = require("node:fs");

const target = process.argv[2];
if (!target) {
  console.error("usage : node scripts/snapshot-db.cjs <chemin de sortie>");
  process.exitCode = 1;
} else {
  const destination = path.resolve(target);
  const db = new Database();

  const tables = db
    .prepare(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    )
    .all()
    .map((row) => row.name);

  const snapshot = { generatedAt: new Date().toISOString(), source: "postgresql", tables: {} };

  let total = 0;
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM "${table}"`).all();
    snapshot.tables[table] = rows;
    total += rows.length;
    console.log(`  ${table.padEnd(42)} ${String(rows.length).padStart(6)} ligne(s)`);
  }
  db.close();

  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, JSON.stringify(snapshot, null, 2), "utf8");

  const size = statSync(destination).size;
  console.log(`instantané : ${destination}`);
  console.log(`  ${tables.length} table(s), ${total} ligne(s), ${(size / 1024).toFixed(0)} Ko`);
}
