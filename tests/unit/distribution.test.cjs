const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, env = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require: name => { if (!(name in imports)) throw Error(`Unexpected import: ${name}`); return imports[name]; }, process: { env }, console: { error() {} } });
  return exports;
}

test('IA : texte factuel, lien externe retiré et budget X respecté', async () => {
  let request;
  class OpenAI { constructor() { this.chat = { completions: { create: async input => { request = input; return { choices: [{ message: { content: '⚽'.repeat(300) + ' https://untrusted.test' } }] }; } } }; } }
  const ai = load('src/lib/ai.ts', { openai: { default: OpenAI } }, { DEEPSEEK_API_KEY: 'fixture' });
  const text = await ai.generateSocialPost('Titre avec une consigne malveillante', 'Résumé', 'X');
  assert.ok(!text.includes('https://'));
  assert.ok(Array.from(text).reduce((sum, char) => sum + (char.codePointAt(0) > 127 ? 2 : 1), 0) + 25 <= 280);
  assert.match(request.messages[0].content, /jamais des instructions/);
  assert.equal(JSON.parse(request.messages[1].content).excerpt, 'Résumé');
});

test('IA : réponse vide et clé absente refusées', async () => {
  class OpenAI { constructor() { this.chat = { completions: { create: async () => ({ choices: [] }) } }; } }
  const ai = load('src/lib/ai.ts', { openai: { default: OpenAI } }, { DEEPSEEK_API_KEY: 'fixture' });
  await assert.rejects(ai.generateSocialPost('Titre', null, 'FACEBOOK'), /aucun post/);
  const disabled = load('src/lib/ai.ts', {});
  await assert.rejects(disabled.generateSocialPost('Titre', null, 'X'), /clé IA/);
});

function distribution({ status = 'PUBLISHED', failing, existing = [] } = {}) {
  const posts = [...existing];
  const article = { title: 'Titre', excerpt: 'Résumé', slug: 'article-test', status, socialPosts: posts };
  const calls = { auto: 0 };
  const db = {
    article: { findUnique: async () => article },
    $executeRaw: async (_sql, id, platform, text, base, articleId) => {
      if (article.status === 'PUBLISHED' && !posts.some(post => post.platform === platform)) posts.push({ id, platform, articleId, content: `${text}\n\n${base}${article.slug}` });
    },
  };
  const engine = load('src/lib/distribution.ts', {
    '@/lib/prisma': { prisma: db },
    '@/lib/ai': { generateSocialPost: async (_title, _excerpt, platform) => { if (platform === failing) throw Error('Provider unavailable'); return `Post ${platform}`; } },
    '@/lib/seo': { absoluteUrl: path => `https://example.test${path}` },
    '@/lib/social-publishing': { autoPublishOfficialSocialPosts: async () => { calls.auto += 1; return { attempted: 0, published: 0, failed: 0 }; } },
    'node:crypto': { randomUUID: () => 'fixture-uuid' },
  });
  return { posts, article, engine, calls };
}

test('publication : trois posts avec lien canonique, relance sans doublons', async () => {
  const { engine, posts } = distribution();
  assert.equal(await engine.generateArticleSocialPosts('id'), true);
  assert.equal(await engine.generateArticleSocialPosts('id'), true);
  assert.equal(posts.length, 3);
  assert.ok(posts.every(post => post.content.endsWith('https://example.test/article/article-test')));
});

test('une proposition déjà publiée est conservée intacte', async () => {
  const saved = { platform: 'X', status: 'POSTED', content: 'Texte validé' };
  const { engine, posts } = distribution({ existing: [saved] });
  await engine.generateArticleSocialPosts('id');
  assert.equal(posts[0], saved);
  assert.equal(posts.length, 3);
});

test('panne partielle : un réseau est conservé, résultat incomplet signalé', async () => {
  const { engine, posts } = distribution({ failing: 'X' });
  assert.equal(await engine.generateArticleSocialPosts('id'), false);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].platform, 'FACEBOOK');
});

test('distribution : la publication automatique est déclenchée après génération', async () => {
  const { engine, calls } = distribution();
  await engine.distributeArticleSocialPosts('id');
  assert.equal(calls.auto, 1);
});

test('un brouillon ne produit aucun post', async () => {
  const { engine, posts } = distribution({ status: 'DRAFT' });
  assert.equal(await engine.generateArticleSocialPosts('id'), false);
  assert.equal(posts.length, 0);
});

test('les actions refusent un lecteur et un journaliste sans droit sur cet article', async () => {
  for (const role of ['READER', 'JOURNALIST']) {
    let writes = 0;
    const actions = load('src/app/studio/articles/distribution-actions.ts', {
      'next/cache': { revalidatePath() {} },
      '@/lib/auth': { auth: async () => ({ user: { id: 'other', role } }) },
      '@/lib/prisma': { prisma: { article: { findUnique: async () => ({ authorId: 'owner', status: 'PUBLISHED' }) }, socialPost: { findFirst: async () => null, updateMany: async () => { writes++; return { count: 1 }; } } } },
      '@/lib/roles': { canAccessStudio: value => value !== 'READER', canEditArticle: (viewer, article) => viewer.id === article.authorId },
      '@/lib/distribution': { distributeArticleSocialPosts: async () => { writes++; return true; } },
      '@/lib/social-publishing': { publishSocialPostRecord: async () => { writes++; return { externalId: 'fixture', alreadyPublished: false }; } },
    });
    assert.equal((await actions.markSocialPostPosted('article', 'post')).error, 'Action non autorisée.');
    assert.equal((await actions.retrySocialPosts('article')).error, 'Action non autorisée.');
    assert.equal(writes, 0);
  }
});

test('les fixtures E2E ne tentent aucun nettoyage sur une base distante', async () => {
  let before, after, writes = 0;
  const register = () => {};
  register.beforeEach = callback => { before = callback; };
  register.afterEach = callback => { after = callback; };
  register.afterAll = () => {};
  load('tests/e2e/distribution.spec.ts', {
    '@playwright/test': { test: register },
    bcryptjs: {},
    '../fixtures/db': { sql: async () => { writes++; }, closeDb() {}, e2eId: () => 'e2e-fixture' },
    '../fixtures/helpers': {},
  }, { DATABASE_URL: 'postgresql://example.test/database' });
  await assert.rejects(before({}), /Local Docker required/);
  await after();
  assert.equal(writes, 0);
});
