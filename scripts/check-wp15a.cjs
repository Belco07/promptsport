/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
try { process.loadEnvFile(); } catch {}
const base = process.env.WP15A_BASE_URL || 'http://127.0.0.1:3002';
assert.equal(new URL(base).port, '3002', 'WP15a targets only PromptSport');
let checks = 0;
function check(value, label) { assert.ok(value, label); console.log('OK', label); checks++; }
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let fixtureAuthor;
  try {
    const { rows } = await db.query(`SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name='Article' AND column_name='format'`);
    check(rows.length === 1 && rows[0].column_default.includes('NEWS') && rows[0].is_nullable === 'NO', 'Format obligatoire, défaut NEWS');
    const enums = await db.query(`SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=enumtypid WHERE typname='ArticleFormat' ORDER BY enumsortorder`);
    assert.deepEqual(enums.rows.map(r => r.enumlabel), ['FLASH', 'NEWS', 'ANALYSIS']); checks++;
    const response = await fetch(base);
    check(response.ok, 'Accueil HTTP 200');
    const html = await response.text();
    check(!/"digest":"\d+"/.test(html), 'Accueil sans erreur serveur');
    const articles = await db.query(`SELECT slug, format FROM "Article" WHERE status='PUBLISHED' AND "publishedAt"<=NOW()`);
    const formats = new Map(articles.rows.map(r => [r.slug, r.format]));
    for (const [marker, expected] of [['data-home-hero', 'NEWS'], ['id="analyses"', 'ANALYSIS'], ['data-latest-page', 'NEWS']]) {
      const start = html.indexOf(marker);
      check(start >= 0, `Bloc ${marker} présent`);
      const end = html.indexOf('</section>', start);
      const block = html.slice(start, end);
      for (const match of block.matchAll(/href="\/article\/([^"?#]+)"/g)) {
        check(formats.get(match[1]) === expected, `${match[1]} dans ${expected}`);
      }
    }
    const form = fs.readFileSync('src/app/studio/articles/ArticleForm.tsx', 'utf8');
    check(form.includes('ssr: false') && form.includes('<RichTextEditor'), 'Éditeur chargé côté client');
    check(!/<textarea[^>]*[\s\S]{0,100}name="content"/.test(form), 'Textarea de contenu remplacée');
    check(form.includes('name="format"'), 'Sélecteur de format présent');
    const { randomUUID } = require('node:crypto');
    fixtureAuthor = `wp15a-${randomUUID()}`;
    const email = `${fixtureAuthor}@example.invalid`;
    const password = randomUUID();
    await db.query(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,'Test WP15a',$2,$3,'ADMIN',NOW())`, [fixtureAuthor,email,await require('bcryptjs').hash(password,10)]);
    const cookies = new Map();
    async function request(path, options = {}) {
      const response = await fetch(new URL(path,base), { ...options, redirect:'manual', headers:{ cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '), origin:base, ...options.headers } });
      for (const cookie of response.headers.getSetCookie()) { const pair=cookie.split(';')[0]; const index=pair.indexOf('='); cookies.set(pair.slice(0,index),pair.slice(index+1)); }
      return { status:response.status, body:await response.text() };
    }
    function actionForm(html) {
      const result = new FormData();
      const articleForm = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match=>match[0]).find(value=>value.includes('name="format"'));
      check(Boolean(articleForm),'Formulaire article isolé des autres actions');
      for (const input of articleForm.matchAll(/<input\b[^>]*>/g)) {
        const name=input[0].match(/name="([^"]+)"/)?.[1];
        const value=input[0].match(/value="([^"]*)"/)?.[1] || '';
        if (name?.startsWith('$ACTION')) result.append(name,value.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#x27;',"'"));
      }
      check([...result.keys()].length > 0,'Métadonnées de Server Action présentes');
      return result;
    }
    const csrf=JSON.parse((await request('/api/auth/csrf')).body).csrfToken;
    await request('/api/auth/callback/credentials',{method:'POST',body:new URLSearchParams({csrfToken:csrf,email,password,callbackUrl:base+'/studio'})});
    const session=JSON.parse((await request('/api/auth/session')).body);
    check(session.user?.id===fixtureAuthor,'Session de test authentifiée');
    const category=(await db.query('SELECT id FROM "Category" LIMIT 1')).rows[0].id;
    const markdown='# Titre\n\n**Gras** et *italique* et ~~barré~~ et `code`.\n\n- Premier\n- Second\n\n> Citation\n\n[Lien](https://example.com)\n\n```txt\nCode\n```';
    for (const format of ['FLASH','NEWS','ANALYSIS']) {
      const page=await request('/studio/articles/new');
      check(page.status===200 && page.body.includes('Chargement de l’éditeur'),'Formulaire SSR sans contenu brut');
      const payload=actionForm(page.body);
      const slug=`${fixtureAuthor}-${format.toLowerCase()}`;
      for (const [key,value] of Object.entries({title:`Test ${format}`,slug,content:markdown,categoryId:category,status:'DRAFT',format,isPremium:'on'})) payload.set(key,value);
      const created=await request('/studio/articles/new',{method:'POST',body:payload});
      check(created.status===303,`Création ${format}`);
      const row=(await db.query('SELECT * FROM "Article" WHERE slug=$1',[slug])).rows[0];
      check(row?.format===format && row.content.replaceAll('\r\n','\n')===markdown && row.isPremium,`Markdown et format ${format} persistés`);
      const editPath=`/studio/articles/${row.id}/edit`;
      const edit=await request(editPath);
      const update=actionForm(edit.body);
      for (const [key,value] of Object.entries({title:`Test ${format}`,slug,content:markdown+'\n\nModification.',categoryId:category,status:'DRAFT',format,isPremium:'on'})) update.set(key,value);
      check((await request(editPath,{method:'POST',body:update})).status===303,`Édition ${format}`);
      const saved=(await db.query('SELECT content,format,"isPremium" FROM "Article" WHERE id=$1',[row.id])).rows[0];
      check(saved.content.endsWith('Modification.') && saved.format===format && saved.isPremium,'Édition conserve format et premium');
      update.set('format','INVALID');
      await request(editPath,{method:'POST',body:update});
      check((await db.query('SELECT format FROM "Article" WHERE id=$1',[row.id])).rows[0].format===format,'Format invalide refusé');
      update.set('format',format); update.set('status','PUBLISHED');
      check((await request(editPath,{method:'POST',body:update})).status===303,`Publication ${format}`);
      const publicHome=await (await fetch(base)).text();
      const marker=format==='FLASH'?'data-home-wire':format==='ANALYSIS'?'id="analyses"':'data-latest-page';
      const start=publicHome.indexOf(marker);
      const end=publicHome.indexOf(format==='FLASH'?'</aside>':'</section>',start);
      check(start>=0 && publicHome.slice(start,end).includes(`/article/${slug}`),`${format} dans son bloc de l’accueil`);
      const publicArticle=await (await fetch(new URL(`/article/${slug}`,base))).text();
      check(format==='NEWS' ? !publicArticle.includes('data-article-format=') : publicArticle.includes(`data-article-format="${format}"`),format==='NEWS' ? 'Pas de badge pour une actualité (format par défaut)' : 'Badge de format sur la page article');
      check(publicArticle.includes('Cet article est réservé aux abonnés'),'Paywall anonyme conservé');
      update.set('status','DRAFT');
      check((await request(editPath,{method:'POST',body:update})).status===303,'Dépublication de la fixture');
    }
    console.log(`WP15a : ${checks} contrôles réussis.`);
  } finally {
    if (fixtureAuthor) {
      await db.query('DELETE FROM "Article" WHERE "authorId"=$1',[fixtureAuthor]);
      await db.query('DELETE FROM "Author" WHERE id=$1',[fixtureAuthor]);
    }
    await db.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
