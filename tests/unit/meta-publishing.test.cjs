const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(fetchImpl, env) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/lib/social-platforms.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    URL,
    URLSearchParams,
    AbortSignal,
    fetch: fetchImpl,
    process: { env },
    console: { log() {}, warn() {}, error() {} },
    require: () => ({}),
  });
  return exports;
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test('Facebook : publie sur la Page configurée avec le token de publication', async () => {
  const calls = [];
  const connector = load(async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ id: 'page-post-123' });
  }, {
    META_FACEBOOK_TOKEN: 'page-token',
    META_FACEBOOK_PAGE_ID: '497158287420123',
  });

  const result = await connector.publishFacebookPost('Une actualité PromptSport.');
  assert.equal(result.id, 'page-post-123');
  assert.match(calls[0].url, /graph\.facebook\.com\/v23\.0\/497158287420123\/feed$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.get('message'), 'Une actualité PromptSport.');
  assert.equal(calls[0].options.body.get('access_token'), 'page-token');
});

test('Instagram : crée le conteneur, attend l’image puis publie', async () => {
  const calls = [];
  const connector = load(async (url, options) => {
    calls.push({ url: String(url), options });
    const target = String(url);
    if (target.endsWith('/media')) return jsonResponse({ id: 'container-123' });
    if (target.includes('/container-123')) return jsonResponse({ status_code: 'FINISHED' });
    if (target.endsWith('/media_publish')) return jsonResponse({ id: 'media-456' });
    throw Error(`Unexpected URL: ${target}`);
  }, {
    META_ACCESS_TOKEN: 'instagram-token',
    META_IG_USER_ID: '17841400000000000',
  });

  const result = await connector.publishInstagramPost(
    'Une actualité PromptSport.',
    'https://example.test/article/test/opengraph-image',
  );
  assert.equal(result.id, 'media-456');
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/17841400000000000\/media$/);
  assert.equal(calls[0].options.body.get('image_url'), 'https://example.test/article/test/opengraph-image');
  assert.match(calls[1].url, /container-123\?fields=status_code$/);
  assert.match(calls[2].url, /\/17841400000000000\/media_publish$/);
  assert.equal(calls[2].options.body.get('creation_id'), 'container-123');
});

test('Instagram : refuse une image non HTTPS avant tout appel réseau', async () => {
  let called = false;
  const connector = load(async () => {
    called = true;
    return jsonResponse({ id: 'unexpected' });
  }, {
    META_ACCESS_TOKEN: 'instagram-token',
    META_IG_USER_ID: '17841400000000000',
  });

  await assert.rejects(
    connector.publishInstagramPost('Texte', 'http://localhost/image.png'),
    /HTTPS public/,
  );
  assert.equal(called, false);
});
