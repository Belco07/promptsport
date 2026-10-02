/**
 * Vérification de la structure réelle de la base (WP2a, adaptée PostgreSQL au
 * WP12a). Exécution : node scripts/wp2a-db-check.cjs
 *
 * Contrôle les 3 tables d'origine, leurs colonnes, les clés étrangères, les
 * valeurs par défaut (cuid, now, updatedAt) et les contraintes d'unicité — lues
 * dans les catalogues PostgreSQL (`information_schema`, `pg_constraint`).
 */
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");

const db = new Database();

const tables = db
  .prepare(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )
  .all()
  .map((row) => row.name);
console.log(`base analysee : PostgreSQL (${tables.length} tables)`);
console.log(`tables : ${tables.join(", ")}`);

const expected = ["Article", "Author", "Category"];
const missing = expected.filter((table) => !tables.includes(table));
console.log(
  missing.length === 0
    ? "OK: les 3 tables attendues existent"
    : `ECHEC: tables manquantes -> ${missing.join(", ")}`,
);

for (const table of expected) {
  if (!tables.includes(table)) continue;
  console.log(`\n[${table}]`);
  const columns = db
    .prepare(
      `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS "default"
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
    )
    .all(table);
  console.log("  colonnes : " + columns.map((c) => c.name).join(", "));

  const primaryKey = db
    .prepare(
      `SELECT kcu.column_name AS name FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
       WHERE tc.table_schema = 'public' AND tc.table_name = ? AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`,
    )
    .all(table)
    .map((row) => row.name);
  console.log("  primary key : " + primaryKey.join(", "));
  console.log(
    "  NOT NULL : " + columns.filter((c) => c.nullable === "NO").map((c) => c.name).join(", "),
  );

  const defaults = columns.filter((c) => c.default !== null);
  if (defaults.length) {
    console.log("  defauts : " + defaults.map((c) => `${c.name}=${c.default}`).join(" | "));
  }

  const uniques = db
    .prepare(
      `SELECT indexname AS name, indexdef AS def FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ? AND indexdef LIKE '%UNIQUE%' ORDER BY indexname`,
    )
    .all(table);
  if (uniques.length) {
    console.log("  index uniques : " + uniques.map((i) => i.name).join(" | "));
  }
}

console.log("\n[cles etrangeres de Article]");
for (const fk of db
  .prepare(
    `SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint
     WHERE conrelid = ?::regclass AND contype = 'f' ORDER BY conname`,
  )
  .all('"Article"')) {
  console.log(`  ${fk.name} : ${fk.def}`);
}

console.log("\n[migrations]");
for (const migration of db
  .prepare("SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at")
  .all()) {
  console.log(`  ${migration.migration_name} — appliquee=${Boolean(migration.finished_at)}`);
}

db.close();
console.log(
  missing.length === 0
    ? "\nRESULTAT: base conforme (3 tables + relations)"
    : "\nRESULTAT: base NON conforme",
);
process.exitCode = missing.length === 0 ? 0 : 1;
