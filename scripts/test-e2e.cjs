// Même environnement isolé pour la CI et les validations locales de production.
const http = require('node:http');
const path = require('node:path');
try { process.loadEnvFile(); } catch { /* Les variables sont fournies par la CI. */ }
const raw = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const database = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '5432') throw Error('E2E réservés à PostgreSQL Docker local sur le port 5432.');
const vapid = require('web-push').generateVAPIDKeys();
Object.assign(process.env, {
  DATABASE_URL: raw, APP_DATABASE_URL: raw, DIRECT_URL: raw,
  PRISMA_PG_DIRECT: '1', FOTMOB_LIVE: '0', AUTO_PUBLISH_ANALYSIS: 'false',
  E2E_WP48: '1', E2E_VISUAL_LOCAL: '1', E2E_VISUAL_BLOB_STUB: '1',
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'https://example.test',
});
const transport = path.resolve('tests/fixtures/wp48-push-transport.cjs').replaceAll('\\', '/');
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require="${transport}"`.trim();
const requests = [];
const collector = http.createServer((request, response) => {
  if (request.url === '/__requests') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(requests)); return; }
  let bytes = 0;
  request.on('data', chunk => { bytes += chunk.length; });
  request.on('end', () => { requests.push({ path: request.url, bytes }); response.writeHead(201); response.end(); });
});
collector.on('error', () => { console.error('Le port local 5468 doit être libre pour le collecteur push E2E.'); process.exitCode = 1; });
collector.listen(5468, '127.0.0.1', () => {
  if (process.argv.length === 2) process.argv.push('tests/e2e');
  process.argv.push('--config', 'playwright.visual-production.config.ts');
  require('./test-distribution.cjs');
});
process.on('exit', () => collector.close());
