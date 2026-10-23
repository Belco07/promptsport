const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(fs.readFileSync('src/lib/news-virality.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports, mod);
const { computeViralScore } = mod.exports;
const now = new Date('2026-10-23T12:00:00Z');
test('une actualité ancienne sans signal reste à 1 ; une annonce officielle urgente plafonne à 5', () => {
  assert.equal(computeViralScore({ title: 'Entraînement de mardi', publishedAt: new Date('2026-10-22'), isOfficial: false }, now), 1);
  assert.equal(computeViralScore({ title: 'OFFICIEL : accord et signature du transfert', publishedAt: now, isOfficial: true, reliability: 90 }, now), 5);
});
test('fraîcheur limitée à deux heures, sans bonus pour une date future aberrante', () => {
  assert.equal(computeViralScore({ title: 'Entraînement', publishedAt: now, isOfficial: false }, now), 2);
  assert.equal(computeViralScore({ title: 'Entraînement', publishedAt: new Date('2027-01-01'), isOfficial: false }, now), 1);
});
