import { test, expect } from "@playwright/test";

test.use({ serviceWorkers: "allow" });
import { sql, closeDb, e2eId } from "../fixtures/db";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true });
let id: string;
test.beforeEach(async () => {
  id=e2eId("pwa");
  await sql('INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,\'unused-e2e-pwa\',\'EDITOR\',NOW())',[id,`${id}@example.test`]);
  await sql('INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())',[id]);
  await sql('INSERT INTO "Article" (id,title,slug,content,excerpt,format,status,"authorId","categoryId","publishedAt","createdAt","updatedAt") VALUES ($1,$1,$1,$2,\'Lecture hors ligne\',\'NEWS\',\'PUBLISHED\',$1,$1,NOW(),NOW(),NOW())',[id,'Contenu public sauvegardé pour le test PWA. '.repeat(25)]);
});
test.afterEach(async()=>{await sql('DELETE FROM "AnalyticsPageView" WHERE "articleId"=$1',[id]);await sql('DELETE FROM "Article" WHERE id=$1',[id]);await sql('DELETE FROM "Category" WHERE id=$1',[id]);await sql('DELETE FROM "Author" WHERE id=$1',[id]);await closeDb();});

test('PWA : manifeste, lecture sauvegardée hors ligne et retour réseau',async({page,context})=>{
  // Some devices keep onLine=true when the uplink fails. The saved document
  // must still identify itself as offline without relying on that heuristic.
  await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'onLine',{get:()=>true}));
  await page.goto('/article/'+id);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','/manifest.json');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content','yes');
  const manifest=await (await page.request.get('/manifest.json')).json();expect(manifest.icons).toHaveLength(3);
  await expect.poll(()=>page.evaluate(async()=>Boolean(await (await caches.open('promptsport-pages-v1')).match(location.origin+location.pathname))),{timeout:60000}).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading',{name:id,exact:true})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'Hors connexion'})).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({hasText:'Hors connexion'})).toHaveCount(0);
});

test('PWA : indicateur standalone et navigation fixée sans débordement',async({page})=>{
  await page.addInitScript(()=>{const native=window.matchMedia.bind(window);window.matchMedia=query=>{const media=native(query);if(query==='(display-mode: standalone)')Object.defineProperty(media,'matches',{value:true});return media;};});
  await page.goto('/article/'+id);
  const nav=page.getByRole('navigation',{name:'Navigation mobile',exact:true});await expect(nav).toHaveAttribute('data-standalone','true');
  await expect(nav.getByText('Application PromptSport')).toBeVisible();
  const rect=await nav.boundingBox();expect(rect).not.toBeNull();expect(Math.round(rect!.y+rect!.height)).toBe(844);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('pwa-mobile.png')});
});

test('PWA : un article premium ne sauvegarde que son aperçu public',async({page,context})=>{
  const secret='CONTENU_PREMIUM_NON_SAUVEGARDE_'+id;
  await sql('UPDATE "Article" SET "isPremium"=true, content=$2 WHERE id=$1',[id,secret]);
  await page.goto('/article/'+id);
  await expect.poll(()=>page.evaluate(async()=>Boolean(await (await caches.open('promptsport-pages-v1')).match(location.origin+location.pathname))),{timeout:60000}).toBe(true);
  const saved=await page.evaluate(async()=>{const response=await (await caches.open('promptsport-pages-v1')).match(location.origin+location.pathname);return response?.text();});
  expect(saved).not.toContain(secret);
  await context.setOffline(true);await page.reload();
  await expect(page.locator('p.whitespace-pre-line')).toHaveText('Lecture hors ligne');
  await expect(page.getByText(secret,{exact:true})).toHaveCount(0);
});
