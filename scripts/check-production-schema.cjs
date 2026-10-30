// Diagnostic en lecture seule : ni données personnelles, ni URL complète.
const { Client } = require('pg');
(async () => {
  const url = new URL(process.env.DIRECT_URL || '');
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 15000, statement_timeout: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
    const tables = new Set(rows.map(row => row.table_name));
    const result = { host: url.hostname, tables: tables.size, hasArticles: tables.has('Article'), hasMigrationHistory: tables.has('_prisma_migrations') };
    if (tables.has('Article')) result.articles = Number((await client.query('SELECT count(*) FROM "Article"')).rows[0].count);
    if (tables.has('_prisma_migrations')) result.appliedMigrations = Number((await client.query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count);
    console.log('[schema-readonly] '+JSON.stringify(result));
    await client.query('ROLLBACK');
  } finally { await client.end(); }
})().catch(error => { console.error('[schema-readonly] Diagnostic indisponible : '+(error.code || error.name)); process.exitCode=1; });
