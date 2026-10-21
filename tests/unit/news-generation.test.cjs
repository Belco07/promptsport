const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function aiResponse(content) {
  let request;
  class OpenAI { constructor() { this.chat = { completions: { create: async input => { request = input; return { choices: [{ message: { content } }] }; } } }; } }
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/ai.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, URL, require: name => { assert.equal(name, 'openai'); return { default: OpenAI }; }, process: { env: { DEEPSEEK_API_KEY: 'fixture' } } });
  return { generate: exports.generateArticleFromAlert, request: () => request };
}
const alert = { title: 'Un transfert confirmé', sourceName: 'Source fiable', url: 'https://example.test/news', categories: [{ name: 'Football', slug: 'football' }], themes: [{ name: 'Mercato', slug: 'mercato' }] };
test('génération : JSON, taxonomie proposée et attribution de la source', async () => {
  const ai = aiResponse(JSON.stringify({ title: 'Un transfert confirmé', excerpt: 'Le transfert est confirmé.', content: 'Un transfert confirmé par le club. '.repeat(12), categorySlug: 'football', themeSlug: 'mercato' }));
  const result = await ai.generate(alert);
  assert.equal(result.categorySlug, 'football');
  assert.equal(result.themeSlug, 'mercato');
  assert.match(result.content, /https:\/\/example.test\/news/);
  assert.match(ai.request().messages[1].content, /"slug":"mercato"/);
  assert.equal(ai.request().response_format.type, 'json_object');
});
test('une réponse non JSON ou incomplète ne devient jamais un brouillon', async () => {
  for (const raw of ['Un texte sans JSON. '.repeat(30), '{}', '[]', JSON.stringify({ title: 'Titre', excerpt: 'Extrait', content: '' })]) {
    await assert.rejects(aiResponse(raw).generate(alert));
  }
});
test('sans correspondance, les slugs nuls sont conservés', async () => {
  const ai = aiResponse(JSON.stringify({ title: 'Titre', excerpt: 'Extrait', content: 'Une actualité sportive confirmée. '.repeat(12), categorySlug: null, themeSlug: null }));
  const result = await ai.generate(alert);
  assert.equal(result.categorySlug, null);
  assert.equal(result.themeSlug, null);
});
