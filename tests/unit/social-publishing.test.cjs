const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, env = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    URL,
    require: name => {
      if (!(name in imports)) throw Error(`Unexpected import: ${name}`);
      return imports[name];
    },
    process: { env },
    console: { error() {} },
  });
  return exports;
}

function fixture({ autoPublish = true, facebook = true, instagram = true, failing } = {}) {
  const calls = { facebook: 0, instagram: 0 };
  const updates = [];
  const article = {
    id: 'article',
    slug: 'article-test',
    coverImageUrl: null,
    status: 'PUBLISHED',
    socialAutoPublish: autoPublish,
    socialPosts: [
      { id: 'facebook-post', platform: 'FACEBOOK' },
      { id: 'instagram-post', platform: 'INSTAGRAM' },
    ],
  };
  const posts = {
    'facebook-post': { id: 'facebook-post', platform: 'FACEBOOK', content: 'Post Facebook', status: 'DRAFT', externalId: null, article },
    'instagram-post': { id: 'instagram-post', platform: 'INSTAGRAM', content: 'Post Instagram', status: 'DRAFT', externalId: null, article },
  };
  const prisma = {
    article: { findUnique: async () => article },
    socialPost: {
      findUnique: async ({ where }) => posts[where.id] ?? null,
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { updates.push(data); return data; },
    },
  };
  const engine = load('src/lib/social-publishing.ts', {
    '@/lib/prisma': { prisma },
    '@/lib/seo': { absoluteUrl: path => `https://example.test${path}` },
    '@/lib/social-platforms': {
      facebookPublishingConfigured: () => facebook,
      instagramPublishingConfigured: () => instagram,
      publishFacebookPost: async () => {
        calls.facebook += 1;
        if (failing === 'FACEBOOK') throw Error('Meta refus');
        return { id: 'fb-published' };
      },
      publishInstagramPost: async () => {
        calls.instagram += 1;
        if (failing === 'INSTAGRAM') throw Error('Meta refus');
        return { id: 'ig-published' };
      },
    },
  });
  return { engine, calls, updates, article, posts };
}

test('Instagram : couverture JPEG, sinon conversion de l’image Open Graph', () => {
  const { engine } = fixture();
  assert.equal(engine.resolveSocialImageUrl({ slug: 'test', coverImageUrl: 'https://cdn.test/cover.jpg' }), 'https://cdn.test/cover.jpg');
  assert.equal(engine.resolveSocialImageUrl({ slug: 'test', coverImageUrl: '/uploads/cover.JPEG' }), 'https://example.test/uploads/cover.JPEG');
  assert.equal(engine.resolveSocialImageUrl({ slug: 'test', coverImageUrl: '/uploads/cover.webp' }), 'https://example.test/article/test/instagram-image');
  assert.equal(engine.resolveSocialImageUrl({ slug: 'test', coverImageUrl: null }), 'https://example.test/article/test/instagram-image');
});

test('auto-publication : source officielle, Facebook et Instagram envoyés', async () => {
  const { engine, calls, updates } = fixture();
  const result = await engine.autoPublishOfficialSocialPosts('article');
  assert.equal(result.attempted, 2);
  assert.equal(result.published, 2);
  assert.equal(result.failed, 0);
  assert.equal(calls.facebook, 1);
  assert.equal(calls.instagram, 1);
  assert.deepEqual(updates.map(update => update.status), ['POSTED', 'POSTED']);
  assert.ok(updates.every(update => update.externalId));
});

test('validation : une source non officielle ne déclenche aucun envoi', async () => {
  const { engine, calls } = fixture({ autoPublish: false });
  const result = await engine.autoPublishOfficialSocialPosts('article');
  assert.equal(result.attempted, 0);
  assert.equal(result.published, 0);
  assert.equal(result.failed, 0);
  assert.equal(calls.facebook, 0);
  assert.equal(calls.instagram, 0);
});

test('un réseau non configuré reste en brouillon sans erreur', async () => {
  const { engine, calls, updates } = fixture({ instagram: false });
  const result = await engine.autoPublishOfficialSocialPosts('article');
  assert.equal(result.attempted, 1);
  assert.equal(result.published, 1);
  assert.equal(result.failed, 0);
  assert.equal(calls.facebook, 1);
  assert.equal(calls.instagram, 0);
  assert.equal(updates.length, 1);
});

test('un échec Meta passe le post en erreur et reste rejouable', async () => {
  const { engine, updates } = fixture({ failing: 'FACEBOOK' });
  const result = await engine.autoPublishOfficialSocialPosts('article');
  assert.equal(result.attempted, 2);
  assert.equal(result.published, 1);
  assert.equal(result.failed, 1);
  assert.ok(updates.some(update => update.status === 'FAILED'));
  assert.ok(updates.some(update => update.status === 'POSTED'));
});
