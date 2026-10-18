/** Repair competition logo URLs without rerunning the seed or changing standings. */
const { Client } = require('pg');
const competitions = require('../prisma/default-competitions.cjs');
try { process.loadEnvFile(); } catch { /* Environment may be supplied by the caller. */ }
const apply = process.argv.includes('--apply');
const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('APP_DATABASE_URL or DATABASE_URL is required.');
const destination = new URL(connectionString);
if (!['localhost', '127.0.0.1'].includes(destination.hostname) || destination.port !== '5432') {
  throw new Error('This repair is restricted to the local Docker database on port 5432.');
}
(async () => {
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await db.query('BEGIN');
    let changed = 0;
    for (const competition of competitions) {
      const rows = await db.query('SELECT id, "logoUrl" FROM "Competition" WHERE slug=$1', [competition.slug]);
      for (const row of rows.rows) {
        if (row.logoUrl === competition.logoUrl) continue;
        console.log(`${apply ? 'UPDATE' : 'PREVIEW'} ${competition.slug}: ${competition.logoUrl}`);
        if (apply) await db.query('UPDATE "Competition" SET "logoUrl"=$1, "updatedAt"=NOW() WHERE id=$2', [competition.logoUrl, row.id]);
        changed++;
      }
    }
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(`${changed} logo URL(s) ${apply ? 'updated' : 'to update; rerun with --apply'}.`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { await db.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
