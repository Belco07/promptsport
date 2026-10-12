/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node verification without dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.WP13D_BASE_URL || 'http://127.0.0.1:3002';
assert.equal(new URL(base).port, '3002', 'Only the PromptSport port may be tested');
let checks = 0;
function check(ok, label) { assert.ok(ok, label); checks++; console.log('OK', label); }
async function read(path) { const response = await fetch(new URL(path, base)); check(response.status===200, `${path} HTTP 200`); const html = await response.text(); check(!/"digest":"\d+"/.test(html), `${path} no streamed server error`); return html; }
function latest(html) { return html.split('data-latest-page=')[1]?.split('<nav')[0] || ''; }
(async () => {
 const source = fs.readFileSync('src/app/page.tsx','utf8');
 check(!/(?:bg|text|border)-(?:white|black|slate|gray|neutral|zinc|stone|red|blue|green|ink)-?\d*\b|(?:bg|text|border)-\[#[\da-f]+\]/i.test(source), 'Home uses semantic colors');
 const html = await read('/');
 for(const marker of ['data-home-today','data-home-hero','data-home-wire','id="mercato"','id="analyses"','id="competitions"','id="plus-lus"','id="derniers-articles"']) check(html.includes(marker), marker);
 check((html.match(/<h1\b/g)||[]).length===1,'One h1');
 check(!/<h2\b/.test(latest(html)), 'Article grid headings are h3');
 check((latest(html).match(/<article\b/g)||[]).length<=12,'At most 12 latest articles');
 check((html.match(/alt="Logo /g)||[]).length===6,'Six competition logos');
 check(html.includes('application/ld+json') && html.includes('Organization'), 'Organization JSON-LD preserved');
 check(html.includes('href="/newsletter"') && html.includes('href="/abonnement"'),'Newsletter and subscription preserved');
 for(const section of ['mercato','analyses']) {
  const filtered = await read(`/?rubrique=${section}`);
  check(filtered.includes(`Derniers articles · ${section}`),`${section} filter title`);
 }
 const page2 = await read('/?page=2');
 check(page2.includes('data-latest-page="2"'),'Page 2 selected');
 check(page2.includes('rel="prev"'), 'Previous page available');
 const invalid = await read('/?page=invalid');
 check(invalid.includes('data-latest-page="1"'),'Invalid pagination normalizes to page 1');
 const cards = [...latest(html).matchAll(/href="(\/article\/[^"#]+)"/g)].map(x=>x[1]);
 const second = [...latest(page2).matchAll(/href="(\/article\/[^"#]+)"/g)].map(x=>x[1]);
 check(!second.some(url=>cards.includes(url)), 'Pagination has no duplicated articles');
 console.log(`WP13d: ${checks} checks passed. Visual, contrast and LCP checks are reported separately.`);
})().catch(error=>{ console.error(error); process.exitCode=1; });
