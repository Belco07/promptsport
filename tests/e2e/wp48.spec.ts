import { test, expect } from "@playwright/test";
import { createECDH, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql, closeDb, e2eId } from "../fixtures/db";
import { login } from "../fixtures/helpers";
let id: string;
let endpoint: string;
const password = "E2e-Wp48-2026!";
test.skip(process.env.E2E_WP48 !== "1", "Utiliser npm run test:wp48 : IA et envois push restent sur la machine locale.");
test.beforeEach(async ({ page, context }, testInfo) => {
  await sql("SELECT 1");
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Docker local requis.");
  if (process.env.E2E_WP48 !== "1") throw Error("Runner WP48 avec transport push local requis.");
  id = e2eId("wp48"); endpoint = `https://fcm.googleapis.com/fcm/send/${id}`;
  await sql('INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,$4::"UserRole",NOW())', [id, `${id}@example.test`, await bcrypt.hash(password, 10), testInfo.title.startsWith("push :") ? "READER" : "ADMIN"]);
  await sql('INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())', [id]);
  await sql('INSERT INTO "Article" (id,title,slug,content,excerpt,format,status,"coverImageUrl","authorId","categoryId","createdAt","updatedAt") VALUES ($1,$1,$1,\'Un Flash sportif confirmé.\',\'Résumé du Flash.\',\'FLASH\',\'DRAFT\',\'/promptsport-og.png\',$1,$1,NOW(),NOW())', [id]);
  await context.grantPermissions(["notifications"]);
  const p256dh = createECDH("prime256v1").generateKeys().toString("base64url");
  const auth = randomBytes(16).toString("base64url");
  await page.addInitScript(({ endpoint, p256dh, auth }) => {
    const storage = "wp48-subscription";
    Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => { sessionStorage.setItem("wp48-permission-requests", String(Number(sessionStorage.getItem("wp48-permission-requests") || 0) + 1)); return "granted"; } });
    const subscription = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh, auth } }), unsubscribe: async () => { sessionStorage.removeItem(storage); return true; } };
    Object.defineProperty(PushManager.prototype, "subscribe", { configurable: true, value: async (options: PushSubscriptionOptionsInit) => { if (!options.userVisibleOnly || !options.applicationServerKey) throw Error("Opt-in requis"); sessionStorage.setItem(storage, "1"); return subscription; } });
    Object.defineProperty(PushManager.prototype, "getSubscription", { configurable: true, value: async () => sessionStorage.getItem(storage) ? subscription : null });
  }, { endpoint, p256dh, auth });
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  await login(page, { email: `${id}@example.test`, password, name: id });
});
test.afterEach(async ({ page }) => {
  await page.goto("about:blank");
  await sql('DELETE FROM "PushSubscription" WHERE "readerId"=$1', [id]);
  await sql('DELETE FROM "Article" WHERE "authorId"=$1', [id]);
  await sql('DELETE FROM "NewsSource" WHERE id=$1', [id]);
  await sql('DELETE FROM "Category" WHERE id=$1', [id]);
  await sql('DELETE FROM "Author" WHERE id=$1', [id]);
});
test.afterAll(closeDb);

test("push : opt-in explicite, enregistrement et désactivation sur l’appareil", async ({ page, request }) => {
  expect((await request.get("/api/push/subscriptions")).status()).toBe(401);
  await page.goto("/mon-compte/preferences");
  const button = page.getByRole("button", { name: "Recevoir les alertes sur mon téléphone", exact: true });
  await expect(button).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("wp48-permission-requests"))).toBeNull();
  expect(await sql('SELECT id FROM "PushSubscription" WHERE "readerId"=$1', [id])).toHaveLength(0);
  await button.click();
  await expect(page.getByRole("button", { name: "Désactiver les alertes sur cet appareil", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await sql('SELECT id FROM "PushSubscription" WHERE "readerId"=$1', [id])).toHaveLength(1);
  const denied = await page.request.post("/api/push/subscriptions", { data: { endpoint: "https://127.0.0.1/private", keys: { p256dh: "bad", auth: "bad" } } });
  expect(denied.status()).toBe(400);
  const csrf = await page.request.delete("/api/push/subscriptions", { headers: { Origin: "https://evil.test" }, data: { endpoint } });
  expect(csrf.status()).toBe(403);
  await page.reload();
  await page.getByRole("button", { name: "Désactiver les alertes sur cet appareil", exact: true }).click();
  await expect(page.getByRole("button", { name: "Recevoir les alertes sur mon téléphone", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await sql('SELECT id FROM "PushSubscription" WHERE "readerId"=$1', [id])).toHaveLength(0);
});

test("Flash : publication, envoi chiffré local et affichage par le Service Worker", async ({ page, context }) => {
  test.setTimeout(120000);
  await page.goto("/mon-compte/preferences");
  await page.getByRole("button", { name: "Recevoir les alertes sur mon téléphone", exact: true }).click();
  await expect(page.getByRole("button", { name: "Désactiver les alertes sur cet appareil", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await sql<{ pushNotifiedAt: string | null }>('SELECT "pushNotifiedAt" FROM "Article" WHERE id=$1', [id]))[0].pushNotifiedAt).toBeNull();
  await page.goto("/studio/articles");
  const row = page.getByRole("row").filter({ hasText: id });
  await expect(row.getByText("FLASH", { exact: true })).toBeVisible();
  await row.getByLabel("Statut de l'article", { exact: true }).selectOption("PUBLISHED");
  await expect.poll(async () => (await sql<{pushNotifiedAt:string|null}>('SELECT "pushNotifiedAt" FROM "Article" WHERE id=$1', [id]))[0].pushNotifiedAt).not.toBeNull();
  await expect.poll(async () => (await (await page.request.get("http://127.0.0.1:5468/__requests")).json()).some((item: {path:string;bytes:number}) => item.path.endsWith(id) && item.bytes > 0)).toBe(true);
  await expect.poll(async () => (await sql<{count:number}>('SELECT count(*)::int AS count FROM "SocialPost" WHERE "articleId"=$1', [id]))[0].count).toBe(3);
  const devtools = await context.newCDPSession(page);
  let registrationId = "";
  devtools.on("ServiceWorker.workerRegistrationUpdated", event => { const registration = event.registrations.find((item: {scopeURL:string}) => item.scopeURL === new URL(page.url()).origin + "/"); if (registration) registrationId = registration.registrationId; });
  await devtools.send("ServiceWorker.enable");
  await expect.poll(() => registrationId).not.toBe("");
  await devtools.send("ServiceWorker.startWorker", { scopeURL: new URL(page.url()).origin + "/" });
  await expect.poll(() => context.serviceWorkers().filter(worker => worker.url().endsWith("/sw.js")).length).toBe(1);
  const worker = context.serviceWorkers().find(worker => worker.url().endsWith("/sw.js"))!;
  await worker.evaluate(() => {
    const scope = globalThis as unknown as { registration: ServiceWorkerRegistration; wp48Notifications: string[] };
    scope.wp48Notifications = [];
    const show = scope.registration.showNotification.bind(scope.registration);
    scope.registration.showNotification = async (title, options) => { scope.wp48Notifications.push(title); return show(title, options); };
  });
  await devtools.send("ServiceWorker.deliverPushMessage", { origin: new URL(page.url()).origin, registrationId, data: JSON.stringify({ title: "Flash WP48", body: "Notification de test locale.", url: `/article/${id}`, tag: id }) });
  await expect.poll(() => worker.evaluate(() => (globalThis as unknown as { wp48Notifications: string[] }).wp48Notifications)).toContain("Flash WP48");
  await devtools.detach();
});

test("formats : charte Flash et News en veille, Analyse réservée au parcours dédié", async ({ page }) => {
  test.setTimeout(120000);
  await sql('INSERT INTO "NewsSource" (id,name,type,url,active,"createdAt","updatedAt") VALUES ($1,$1,\'RSS\',$2,false,NOW(),NOW())', [id, `https://example.test/${id}`]);
  for (const suffix of ["flash", "news", "analysis"]) await sql('INSERT INTO "NewsAlert" (id,"sourceId",title,url,content,"publishedAt","viralScore","createdAt","updatedAt") VALUES ($1,$2,$1,$3,\'Une actualité sportive confirmée.\',NOW(),5,NOW(),NOW())', [`${id}-${suffix}`, id, `https://example.test/${id}/${suffix}`]);
  await page.goto("/backoffice/veille");
  for (const suffix of ["flash", "news", "analysis"]) {
    await page.locator("[data-alert-id]").filter({ hasText: `${id}-${suffix}` }).getByRole("button", { name: "Générer avec l’IA", exact: true }).click();
    await expect.poll(async () => (await sql('SELECT id FROM "Article" WHERE "authorId"=$1 AND title=$2', [id, `${id}-${suffix}`])).length).toBe(1);
  }
  const articles = await sql<{format:string;status:string;pushNotifiedAt:unknown}>('SELECT format,status,"pushNotifiedAt" FROM "Article" WHERE "newsSourceId"=$1', [id]);
  expect(articles.map(item => item.format).sort()).toEqual(["FLASH", "NEWS", "NEWS"]);
  expect(articles.every(item => item.status === "DRAFT" && item.pushNotifiedAt === null)).toBe(true);
  // L'analyse est une fixture du parcours dédié, jamais un résultat de veille.
  await sql('UPDATE "Article" SET format=\'ANALYSIS\' WHERE "authorId"=$1 AND title=$2', [id, `${id}-analysis`]);
  await page.goto("/studio/articles");
  await expect(page.getByRole("row").filter({hasText:`${id}-analysis`}).getByText("ANALYSE",{exact:true})).toBeVisible();
  expect((await page.request.get("/api/cron/auto-analysis?token=invalid")).status()).toBe(401);
  const manifest = await (await page.request.get("/manifest.webmanifest")).json(); expect(manifest.display).toBe("standalone");
});
