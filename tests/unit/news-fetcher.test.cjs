const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, env = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, URL, Request, Response, Buffer, Date, AbortSignal, process: { env }, console: { log() {}, warn() {}, error() {} }, require: name => { if (!(name in imports)) throw Error(`Unexpected import: ${name}`); return imports[name]; } });
  return exports;
}

function collector({ sources, fail = false, insertedCount } = {}) {
  const source = { id: 'feed', name: 'Feed', type: 'RSS', url: 'https://example.test/rss' };
  const saved = new Map([['feed:https://example.test/known', { url: 'https://example.test/known' }]]);
  const counters = { purges: 0, translations: 0, writes: 0 };
  const db = {
    newsSource: { findMany: async () => sources ?? [source] },
    newsAlert: {
      findMany: async ({ where }) => [...saved.entries()].filter(([key, row]) => key.startsWith(where.sourceId + ':') && where.url.in.includes(row.url)).map(([, row]) => row),
      createMany: async ({ data, skipDuplicates }) => {
        assert.equal(skipDuplicates, true); counters.writes++;
        let count = 0;
        for (const row of data) { const key = row.sourceId + ':' + row.url; if (!saved.has(key)) { saved.set(key, row); count++; } }
        return { count: insertedCount ?? count };
      },
    },
    $disconnect() { throw Error('The shared collector must not disconnect Prisma'); },
  };
  const engine = load('src/lib/news-fetcher.ts', {
    '@/lib/prisma': { prisma: db },
    '@/lib/rss': { fetchRssItems: async url => {
      if (fail || url.includes('failed')) throw Error('Source unavailable');
      return [
        { title: 'Known', url: 'https://example.test/known', content: null, publishedAt: new Date() },
        { title: 'Fresh', url: 'https://example.test/fresh', content: 'Excerpt', publishedAt: new Date() },
        { title: 'Expired', url: 'https://example.test/old', content: null, publishedAt: new Date(Date.now() - 72 * 3600000) },
      ];
    } },
    '@/lib/social': {},
    '@/lib/social-platforms': {},
    '@/lib/ai': { isAiConfigured: () => true, translateTitlesToFrench: async titles => { counters.translations++; return titles.map(title => 'FR ' + title); } },
    '@/lib/news': {
      cleanupOldNewsAlerts: async () => { counters.purges++; return 0; },
      purgeIgnoredNewsAlerts: async () => { counters.purges++; return 0; },
      isRecentNewsItem: date => date.getTime() >= Date.now() - 48 * 3600000,
    },
  });
  return { engine, counters, saved };
}

test('collecte : dédoublonnage, rétention et traduction seulement des nouveautés', async () => {
  const { engine, counters, saved } = collector();
  const first = await engine.fetchNews();
  assert.equal(first.alertsCreated, 1);
  assert.equal(first.itemsReceived, 3);
  assert.equal(saved.get('feed:https://example.test/fresh').titleFr, 'FR Fresh');
  assert.ok(!saved.has('feed:https://example.test/old'));
  assert.equal((await engine.fetchNews()).alertsCreated, 0);
  assert.equal(counters.translations, 1);
});

test('dry-run : aucune écriture, purge ou traduction', async () => {
  const { engine, counters } = collector();
  assert.equal((await engine.fetchNews({ dryRun: true })).alertsCreated, 1);
  assert.deepEqual(counters, { purges: 0, translations: 0, writes: 0 });
});

test('compteur : le nombre réel inséré est utilisé lors d’une collecte concurrente', async () => {
  assert.equal((await collector({ insertedCount: 0 }).engine.fetchNews()).alertsCreated, 0);
});

test('une source indisponible n’empêche pas les autres ; les échecs sont comptés', async () => {
  const sources = [{ id: 'failed', name: 'Failed', type: 'RSS', url: 'https://example.test/failed' }, { id: 'feed', name: 'Feed', type: 'RSS', url: 'https://example.test/rss' }];
  const result = await collector({ sources }).engine.fetchNews({ concurrency: 3 });
  assert.equal(result.sourcesFailed, 1);
  assert.equal(result.sourcesProcessed, 2);
  assert.equal(result.alertsCreated, 1);
  assert.equal((await collector({ fail: true }).engine.fetchNews()).sourcesFailed, 1);
});

test('aucune source active : résultat vide sans arrêt du processus', async () => {
  const result = await collector({ sources: [] }).engine.fetchNews();
  assert.equal(result.alertsCreated, 0);
  assert.equal(result.sourcesProcessed, 0);
});

test('les connecteurs X et Meta reçoivent leurs clés après extraction du CLI', async () => {
  const calls = [];
  const sources = ['X', 'FACEBOOK', 'INSTAGRAM'].map(type => ({ id: type, name: type, type, url: `https://example.test/${type}` }));
  const engine = load('src/lib/news-fetcher.ts', {
    '@/lib/prisma': { prisma: { newsSource: { findMany: async () => sources }, newsAlert: { findMany: async () => [] } } },
    '@/lib/rss': {},
    '@/lib/social': {},
    '@/lib/social-platforms': {
      fetchXItems: async (_url, _limit, token) => { calls.push(['X', token]); return []; },
      fetchFacebookItems: async (_url, _limit, token) => { calls.push(['FACEBOOK', token]); return []; },
      fetchInstagramItems: async (_url, _limit, token, userId) => { calls.push(['INSTAGRAM', token, userId]); return []; },
    },
    '@/lib/ai': { isAiConfigured: () => false },
    '@/lib/news': { cleanupOldNewsAlerts: async () => 0, purgeIgnoredNewsAlerts: async () => 0, isRecentNewsItem: () => true },
  }, { X_BEARER_TOKEN: 'x-fixture', META_ACCESS_TOKEN: 'meta-fixture', META_IG_USER_ID: 'ig-fixture' });
  assert.equal((await engine.fetchNews()).sourcesFailed, 0);
  assert.deepEqual(calls, [['X', 'x-fixture'], ['FACEBOOK', 'meta-fixture'], ['INSTAGRAM', 'meta-fixture', 'ig-fixture']]);
});

function route({ secret = 'unit-secret', result = { alertsCreated: 3, sourcesProcessed: 2, sourcesFailed: 0 }, error = false } = {}) {
  let calls = 0;
  const handler = load('src/app/api/cron/fetch-news/route.ts', {
    'node:crypto': require('node:crypto'),
    'next/server': { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }) } },
    '@/lib/news-fetcher': { fetchNews: async () => { calls++; if (error) throw Error('Sensitive provider details'); return result; } },
  }, secret ? { CRON_SECRET: secret } : {});
  return { handler, calls: () => calls };
}

test('sécurité : absence, mauvais Bearer et paramètre token refusés avant toute collecte', async () => {
  const r = route();
  for (const [query, authorization] of [['', undefined], ['?token=unit-secret', undefined], ['', 'Basic unit-secret'], ['', 'Bearer wrong-token'], ['', 'Bearer unit-secreu']]) {
    const response = await r.handler.GET(new Request('https://example.test/api/cron/fetch-news' + query, { headers: authorization ? { Authorization: authorization } : {} }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(r.calls(), 0);
});

test('Bearer valide : succès JSON, décompte et absence de cache', async () => {
  const r = route();
  const response = await r.handler.GET(new Request('https://example.test/api/cron/fetch-news', { headers: { Authorization: 'Bearer unit-secret' } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, alertsCreated: 3 });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(r.calls(), 1);
});

test('configuration absente et pannes réelles ne produisent pas de faux succès', async () => {
  const request = new Request('https://example.test/api/cron/fetch-news', { headers: { Authorization: 'Bearer unit-secret' } });
  assert.equal((await route({ secret: '' }).handler.GET(request)).status, 503);
  assert.equal((await route({ result: { alertsCreated: 0, sourcesProcessed: 2, sourcesFailed: 2 } }).handler.GET(request)).status, 502);
  const response = await route({ error: true }).handler.GET(request);
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('Sensitive'));
});
