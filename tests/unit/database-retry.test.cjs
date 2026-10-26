const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync('src/lib/database-retry.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    Error,
    Promise,
    setTimeout,
  });
  return exports;
}

test('base : les coupures transitoires sont reconnues, pas les erreurs métier', () => {
  const { isTransientDatabaseError } = load();
  assert.equal(
    isTransientDatabaseError(new Error('Connection terminated unexpectedly')),
    true,
  );
  assert.equal(
    isTransientDatabaseError(
      new Error('Transaction API error: Unable to start a transaction in the given time.'),
    ),
    true,
  );
  assert.equal(isTransientDatabaseError(new Error('Alerte déjà traitée.')), false);
  assert.equal(isTransientDatabaseError('texte'), false);
});

test('base : une opération transitoire est rejouée puis réussit', async () => {
  const { withDatabaseRetry } = load();
  let calls = 0;
  const value = await withDatabaseRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error('Connection terminated unexpectedly');
    return 'ok';
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('base : une erreur métier ne consomme aucun essai supplémentaire', async () => {
  const { withDatabaseRetry } = load();
  let calls = 0;
  await assert.rejects(
    withDatabaseRetry(async () => {
      calls += 1;
      throw new Error('Alerte déjà traitée.');
    }),
    /Alerte déjà traitée/,
  );
  assert.equal(calls, 1);
});
