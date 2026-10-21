const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadNews() {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/news.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    Date,
    require: name => {
      if (name !== '@/lib/prisma') throw Error(`Unexpected import: ${name}`);
      return { prisma: {} };
    },
  });
  return exports;
}

test('rétention : les dates futures ne créent pas d’alerte en avance', () => {
  const { isRecentNewsItem, NEWS_ALERT_FUTURE_TOLERANCE_MS } = loadNews();
  const now = new Date('2026-10-21T12:00:00Z');
  assert.equal(isRecentNewsItem(new Date('2026-10-21T11:00:00Z'), now), true);
  assert.equal(isRecentNewsItem(new Date('2026-10-19T11:00:00Z'), now), false);
  assert.equal(
    isRecentNewsItem(new Date(now.getTime() + NEWS_ALERT_FUTURE_TOLERANCE_MS / 2), now),
    true,
  );
  assert.equal(isRecentNewsItem(new Date('2026-10-24T16:00:00Z'), now), false);
});
