const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(env = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/news-automation.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    Date,
    Intl,
    process: { env },
    require: name => {
      if (name !== '@/lib/prisma') throw Error(`Unexpected import: ${name}`);
      return { prisma: {} };
    },
  });
  return exports;
}

test('quota : 15 par défaut, valeur personnalisée, 0 et valeurs invalides', () => {
  assert.equal(load().maxDailyAiDrafts(), 15);
  assert.equal(load({ MAX_DAILY_AI_DRAFTS: '4' }).maxDailyAiDrafts(), 4);
  assert.equal(load({ MAX_DAILY_AI_DRAFTS: '0' }).maxDailyAiDrafts(), 0);
  assert.equal(load({ MAX_DAILY_AI_DRAFTS: '-2' }).maxDailyAiDrafts(), 15);
  assert.equal(load({ MAX_DAILY_AI_DRAFTS: 'abc' }).maxDailyAiDrafts(), 15);
});

test('quota : la journée éditoriale commence à minuit Africa/Lagos', () => {
  const { startOfEditorialDay } = load();
  assert.equal(
    startOfEditorialDay(new Date('2026-10-22T00:30:00.000Z')).toISOString(),
    '2026-10-21T23:00:00.000Z',
  );
  assert.equal(
    startOfEditorialDay(new Date('2026-10-22T22:59:59.000Z')).toISOString(),
    '2026-10-21T23:00:00.000Z',
  );
  assert.equal(
    startOfEditorialDay(new Date('2026-10-22T23:00:00.000Z')).toISOString(),
    '2026-10-22T23:00:00.000Z',
  );
});

test('quota : le comptage ne vise que les articles issus de la veille depuis le début du jour', async () => {
  const { getAiDraftQuota } = load({ MAX_DAILY_AI_DRAFTS: '15' });
  const now = new Date('2026-10-22T10:00:00.000Z');
  let captured;
  const client = {
    article: {
      count: async args => {
        captured = args;
        return 14;
      },
    },
  };
  const quota = await getAiDraftQuota(now, client);
  assert.equal(quota.limit, 15);
  assert.equal(quota.used, 14);
  assert.equal(quota.remaining, 1);
  assert.equal(captured.where.newsSourceId.not, null);
  assert.equal(captured.where.createdAt.gte.toISOString(), '2026-10-21T23:00:00.000Z');
});

test('quota : le plafond ne peut pas rendre le restant négatif', async () => {
  const { getAiDraftQuota } = load({ MAX_DAILY_AI_DRAFTS: '0' });
  const client = { article: { count: async () => 3 } };
  const quota = await getAiDraftQuota(new Date(), client);
  assert.equal(quota.limit, 0);
  assert.equal(quota.used, 3);
  assert.equal(quota.remaining, 0);
});

test('publication automatique : opt-in et fiabilité 95 exigés', () => {
  const { sourceCanAutoPublish } = load();
  assert.equal(sourceCanAutoPublish({ autoPublish: false, reliability: 100 }), false);
  assert.equal(sourceCanAutoPublish({ autoPublish: true, reliability: 94 }), false);
  assert.equal(sourceCanAutoPublish({ autoPublish: true, reliability: 95 }), true);
});

test('photos : seule une source explicitement licenciée autorise la reprise', () => {
  const { sourceAllowsImageUse } = load();
  assert.equal(sourceAllowsImageUse({ imagePolicy: 'REFERENCE_ONLY' }), false);
  assert.equal(sourceAllowsImageUse({ imagePolicy: 'LICENSED' }), true);
});
