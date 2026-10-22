#!/usr/bin/env node
// Run after the production build against Docker only. Never contact a real
// push provider or the paid AI. --all runs the complete E2E suite.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const http = require('node:http');
try { process.loadEnvFile(); } catch { /* CI supplies the environment. */ }
const connection = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const url = new URL(connection || 'postgresql://invalid');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5432') throw Error('WP48 : Docker localhost:5432 uniquement.');
const keys = require('web-push').generateVAPIDKeys();
Object.assign(process.env, {
  DATABASE_URL: connection, APP_DATABASE_URL: connection, DIRECT_URL: connection,
  VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey,
  VAPID_SUBJECT: 'https://example.test', AUTO_PUBLISH_ANALYSIS: 'false',
  E2E_WP48: '1', E2E_VISUAL_LOCAL: '1', E2E_VISUAL_BLOB_STUB: '1',
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || '--max-old-space-size=3072'} --require=${JSON.stringify(path.resolve('tests/fixtures/wp48-push-transport.cjs'))}`,
});
const requests = [];
const collector = http.createServer((request, response) => {
  if (request.url === '/__requests') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(requests)); return; }
  let bytes = 0;
  request.on('data', chunk => { bytes += chunk.length; });
  request.on('end', () => { requests.push({ path: request.url, bytes }); response.writeHead(201); response.end(); });
});
let runner = fs.readFileSync('scripts/test-distribution.cjs', 'utf8').replaceAll('3002', '3028').replaceAll('5451', '5471').replaceAll('5452', '5472');
runner = runner.replace('const content = social ?', `const analysis = request.messages[0].content.includes('analyste sportif');\n      const format = analysis || title.endsWith('-analysis') ? 'ANALYSIS' : title.endsWith('-flash') ? 'FLASH' : 'NEWS';\n      const content = social ?`)
  .replace('title, categorySlug: category?.slug', 'title, format, categorySlug: category?.slug')
  .replace("content: 'Un article de test factuel. '.repeat(35)", "content: 'Un article de test factuel. '.repeat(analysis ? 160 : 35)");
fs.mkdirSync('tmp-results', { recursive: true });
const runnerPath = path.resolve('tmp-results/wp48-local-runner.cjs');
fs.writeFileSync(runnerPath, runner);
collector.on('error', error => { console.error('Transport push local indisponible :', error.code); process.exitCode = 1; });
collector.listen(5468, '127.0.0.1', () => {
  const specs = process.argv.includes('--all') ? [] : ['tests/e2e/wp48.spec.ts', 'tests/e2e/news-batch.spec.ts', 'tests/e2e/distribution.spec.ts'];
  const child = cp.spawn(process.execPath, [runnerPath, ...specs, '--config', 'playwright.visual-production.config.ts'], { env: process.env, stdio: 'inherit' });
  child.on('error', () => { collector.close(); process.exitCode = 1; });
  child.on('exit', code => { collector.close(); process.exitCode = code ?? 1; });
  process.on('SIGINT', () => { child.kill(); collector.close(); });
});
