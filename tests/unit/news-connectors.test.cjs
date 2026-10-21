const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    URL,
    Request,
    Response,
    Buffer,
    Date,
    AbortSignal,
    process,
    console: { log() {}, warn() {}, error() {} },
    require: name => {
      if (!(name in imports)) throw Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return exports;
}

function plainText(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const rssStub = {
  plainText,
  fetchRssItems: async () => [],
};

test('Flashscore : lit window.fsNewsData, résout les URL et trie par date', () => {
  const connector = load('src/lib/flashscore.ts', { '@/lib/rss': rssStub, '@/lib/news-page': { fetchNewsPage: async () => { throw Error('réseau interdit en test'); } } });
  const html = `<html><script>window.fsNewsData = {"data":{"sections":[{"articles":[{"title":"Ancien","published":1792500000,"url":"/actualites/ancien/old/"},{"title":"Récent","published":1792574195,"url":"/actualites/recent/new/"}]}]}};</script></html>`;
  const items = connector.parseFlashscoreItems(html, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Récent');
  assert.equal(items[0].url, 'https://www.flashscore.fr/actualites/recent/new/');
  assert.equal(items[0].publishedAt.toISOString(), new Date(1792574195 * 1000).toISOString());
});

test('Flashscore : un payload absent est une erreur explicite', () => {
  const connector = load('src/lib/flashscore.ts', { '@/lib/rss': rssStub, '@/lib/news-page': { fetchNewsPage: async () => { throw Error('réseau interdit en test'); } } });
  assert.throws(() => connector.parseFlashscoreItems('<html></html>'), /window\.fsNewsData/);
});

test('Sitemap : lit les titres et dates Google News, et les index', () => {
  const connector = load('src/lib/sitemap.ts', {
    '@/lib/rss': rssStub,
    '@/lib/news-page': { NEWS_BROWSER_USER_AGENT: 'test', cleanXmlValue: value => String(value).replace(/<!\[CDATA\[|\]\]>/g, '').trim(), extractPageMetadata: () => ({ title: null, description: null, publishedAt: null }), fetchNewsPage: async () => { throw Error('réseau interdit en test'); } },
    '@/lib/official-sites': { titleFromArticleUrl: url => url.split('/').filter(Boolean).pop() ?? null },
  });
  const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
    <url><loc>https://example.test/article-1</loc><news:news><news:publication_date>2026-10-21T09:04:30Z</news:publication_date><news:title>Un titre officiel</news:title></news:news></url>
    <url><loc>https://example.test/article-2</loc><lastmod>2026-10-20T10:00:00Z</lastmod></url>
  </urlset>`;
  const parsed = connector.parseSitemap(xml, 'https://example.test/');
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.entries[0].title, 'Un titre officiel');
  assert.equal(parsed.entries[0].newsPublishedAt.toISOString(), '2026-10-21T09:04:30.000Z');
  assert.equal(parsed.entries[1].title, null);
  assert.equal(parsed.entries[1].lastmod.toISOString(), '2026-10-20T10:00:00.000Z');

  const index = `<sitemapindex><sitemap><loc>https://example.test/news.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual([...connector.parseSitemap(index, 'https://example.test/').sitemaps], ['https://example.test/news.xml']);
});

test('Extraction : préfère le vrai titre au sur-titre de catégorie', () => {
  const newsPage = load('src/lib/news-page.ts', { '@/lib/rss': rssStub });
  const html = `<a href="/article/1-avec-la-maniere.html"><h4>ÉQUIPE DE FRANCE FUTSAL</h4><h3>Avec la manière en Moldavie</h3><p>La France a réussi son entrée.</p></a>`;
  const anchors = newsPage.extractAnchors(html, 'https://www.fff.fr/');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].heading, 'Avec la manière en Moldavie');
  assert.equal(anchors[0].text, 'Avec la manière en Moldavie');
});

test('JSON : accepte la forme items de l’API CAF', () => {
  const connector = load('src/lib/news-json.ts', { '@/lib/rss': rssStub });
  const payload = {
    items: [
      {
        title: 'Le tirage de la Ligue des champions',
        url: '/news/le-tirage/',
        date: '2026-10-21T12:00:00Z',
        description: 'La CAF a procédé au tirage.',
      },
    ],
  };
  const items = connector.parseJsonFeed(payload, 'https://www.cafonline.com/', 3);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.cafonline.com/news/le-tirage/');
  assert.equal(items[0].content, 'La CAF a procédé au tirage.');
});

test('Site officiel : un listing de club est restreint à la section courante', () => {
  const newsPage = load('src/lib/news-page.ts', { '@/lib/rss': rssStub });
  const official = load('src/lib/official-sites.ts', { '@/lib/rss': rssStub, '@/lib/news-page': newsPage });
  const html = `<html><body>
    <a href="/articles/article1.php?num=42"><h2>Le titre de la une</h2><p>Un extrait.</p></a>
    <section class="home-curent-news">
      <article><a href="/articles/article1.php?num=42"><h2>Le titre de la une</h2><p>Un extrait.</p></a></article>
    </section>
    <a href="/articles/article1.php?num=99"><h2>Un ancien article</h2></a>
  </body></html>`;
  const rule = official.officialSiteRule('https://www.fcnantes.com/articles/news.php');
  assert.ok(rule);
  const items = official.parseOfficialListing(html, 'https://www.fcnantes.com/articles/news.php', rule, 5);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.fcnantes.com/articles/article1.php?num=42');
  assert.equal(items[0].heading, 'Le titre de la une');
});

test('Site officiel : fusionne les liens image et carte d’un même article', () => {
  const newsPage = load('src/lib/news-page.ts', { '@/lib/rss': rssStub });
  const official = load('src/lib/official-sites.ts', { '@/lib/rss': rssStub, '@/lib/news-page': newsPage });
  const html = `<html><body>
    <a href="/en-GB/news/foo"><span>Learn more about Foo bar</span></a>
    <a href="/en-GB/news/foo"><span>LaLiga SUN 18.10.2026 | genuine Foo bar officiel</span></a>
  </body></html>`;
  const rule = official.officialSiteRule('https://www.laliga.com/en-GB/news');
  assert.ok(rule);
  const items = official.parseOfficialListing(html, 'https://www.laliga.com/en-GB/news', rule, 3);
  assert.equal(items.length, 1);
  assert.equal(items[0].textDate.toISOString(), '2026-10-18T12:00:00.000Z');
  assert.equal(official.officialItemTitle(items[0], rule), 'Foo bar officiel');
});

test('Site officiel : une date de listing est conservée, un domaine inconnu est refusé', () => {
  const newsPage = load('src/lib/news-page.ts', { '@/lib/rss': rssStub });
  const official = load('src/lib/official-sites.ts', { '@/lib/rss': rssStub, '@/lib/news-page': newsPage });
  const html = `<article><a href="/fr/actualites/le-retour"><h2>Le retour au Vélodrome</h2></a><time datetime="2026-10-21T08:30:00Z"></time></article>`;
  const rule = official.officialSiteRule('https://www.om.fr/fr/actualites');
  assert.ok(rule);
  const items = official.parseOfficialListing(html, 'https://www.om.fr/fr/actualites', rule, 5);
  assert.equal(items.length, 1);
  assert.equal(items[0].listingDate.toISOString(), '2026-10-21T08:30:00.000Z');
  assert.equal(official.officialSiteRule('https://example.test/news'), null);
});

test('Métadonnées : Open Graph et date de publication', () => {
  const newsPage = load('src/lib/news-page.ts', { '@/lib/rss': rssStub });
  const metadata = newsPage.extractPageMetadata(`<html><head>
    <meta property="og:title" content="Titre officiel" />
    <meta content="Résumé officiel" name="description" />
    <meta property="article:published_time" content="2026-10-21T10:00:00Z" />
  </head></html>`);
  assert.equal(metadata.title, 'Titre officiel');
  assert.equal(metadata.description, 'Résumé officiel');
  assert.equal(metadata.publishedAt.toISOString(), '2026-10-21T10:00:00.000Z');
});
