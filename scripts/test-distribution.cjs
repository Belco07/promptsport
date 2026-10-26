#!/usr/bin/env node
// IA simulée et tunnel WebSocket pour les tests Docker, sans appel payant.
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const { WebSocketServer } = require('next/dist/compiled/ws');
try { process.loadEnvFile(); } catch { /* CI supplies its environment. */ }
const raw = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const url = new URL(raw);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5432') throw Error('Tests réservés à Docker local sur localhost:5432.');
Object.assign(process.env, {
  DATABASE_URL: raw, APP_DATABASE_URL: raw, DIRECT_URL: raw,
  PRISMA_PG_DIRECT: '1',
  NEON_WS_PROXY: '127.0.0.1:5452',
  DEEPSEEK_API_KEY: 'local-fixture', DEEPSEEK_BASE_URL: 'http://127.0.0.1:5451/v1', E2E_DISTRIBUTION_STUB: '1',
  RESEND_API_KEY: '', BLOB_READ_WRITE_TOKEN: process.env.E2E_VISUAL_BLOB_STUB === '1' ? 'vercel_blob_rw_e2efixture_00000000000000000000000000000000' : '', ALLSPORTS_API_KEY: '', FOOTBALL_DATA_API_KEY: '', FOTMOB_LIVE: '0',
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3002', AUTH_URL: 'http://localhost:3002', PLAYWRIGHT_BASE_URL: 'http://localhost:3002',
});
const ws = new WebSocketServer({ host: '127.0.0.1', port: 5452 });
ws.on('connection', socket => {
  const tcp = net.connect(5432, '127.0.0.1');
  tcp.setKeepAlive(true, 30000);
  tcp.setNoDelay(true);
  socket.on('error', () => tcp.destroy());
  socket.on('message', data => tcp.write(data));
  tcp.on('data', data => { if (socket.readyState === 1) socket.send(data); });
  socket.on('close', () => tcp.destroy());
  tcp.on('error', () => socket.close());
  tcp.on('close', () => socket.close());
});
const ai = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const request = JSON.parse(body);
      const social = request.messages[0].content.includes('posts sportifs');
      const prompt = request.messages[1]?.content ?? '';
      const taxonomy = label => { try { return JSON.parse(prompt.split(label + ' : ')[1]?.split('\n')[0] ?? '[]'); } catch { return []; } };
      const title = prompt.split("Titre de l'alerte : ")[1]?.split('\n')[0] ?? 'Un article sportif de test';
      const category = taxonomy('Catégories disponibles').find(item => title.startsWith(item.slug));
      const theme = taxonomy('Thèmes disponibles').find(item => title.startsWith(item.slug));
      if (!social && title.endsWith('-bad')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({choices:[{message:{content:'invalid json'}}]})); return; }
      const content = social ? '⚽ Le sport nous rassemble ! Découvrez notre analyse. #Sport #PromptSport' : JSON.stringify({ title, categorySlug: category?.slug ?? null, themeSlug: theme?.slug ?? null, excerpt: 'Un résumé factuel.', content: 'Un article de test factuel. '.repeat(35) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: 'fixture', choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop', index: 0 }] }));
    } catch { res.writeHead(400); res.end(); }
  });
});
ai.listen(5451, '127.0.0.1');
const specs = process.argv.slice(2);
// Ne jamais réutiliser un serveur existant susceptible d'employer une vraie
// clé IA ou une autre base : Playwright doit hériter de notre environnement.
async function startTests() {
const stopBlob = process.env.E2E_VISUAL_BLOB_STUB === '1' ? await require('../tests/fixtures/visual-blob-stub.cjs').startVisualBlobStub() : () => {};
const check = net.connect(3002, '127.0.0.1');
check.once('connect', () => {
  check.destroy(); ws.close(); ai.close(); stopBlob();
  console.error('Le port 3002 doit être libre pour démarrer le serveur E2E isolé.');
  process.exit(1);
});
check.once('error', () => {
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...(specs.length ? specs : ['tests/e2e/distribution.spec.ts'])], { env: process.env, stdio: 'inherit' });
  child.on('exit', code => { ws.close(); ai.close(); stopBlob(); process.exit(code ?? 1); });
  process.on('SIGINT', () => { child.kill(); ws.close(); ai.close(); stopBlob(); });
});
}
startTests().catch(error=>{console.error(error.message);ws.close();ai.close();process.exit(1);});
