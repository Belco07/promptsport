import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { login } from "../fixtures/helpers";

const fixtures: { readerId: string; authorId: string; otherId: string; categoryId: string; ids: string[]; slugs: string[]; titles: string[]; email: string; password: string }[] = [];
let data: typeof fixtures[number];

test.beforeEach(async ({ page }) => {
  try { process.loadEnvFile(); } catch { /* The local runner can provide the environment. */ }
  const database = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "5432") throw new Error("WP39 tests require local Docker PostgreSQL on port 5432.");
  const prefix = e2eId("bookmarks");
  data = { readerId: `${prefix}-reader`, authorId: `${prefix}-author`, otherId: `${prefix}-other`, categoryId: `${prefix}-category`, ids: [], slugs: [], titles: [], email: `${prefix}@example.test`, password: "E2eBookmark-2026!pw" };
  fixtures.push(data);
  const hash = await bcrypt.hash(data.password, 10);
  for (const [id, role] of [[data.readerId, "READER"], [data.authorId, "EDITOR"], [data.otherId, "READER"]]) {
    await sql(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,$4::"UserRole",NOW())`, [id, id === data.readerId ? data.email : `${id}@example.test`, hash, role]);
  }
  await sql(`INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())`, [data.categoryId]);
  for (let index = 0; index < 24; index++) {
    const id = `${prefix}-article-${index}`;
    data.ids.push(id); data.slugs.push(id); data.titles.push(`Lecture ${prefix} ${index}`);
    await sql(`INSERT INTO "Article" (id,title,slug,content,excerpt,status,"publishedAt","authorId","categoryId","createdAt","updatedAt") VALUES ($1,$2,$1,$3,'Un article à retrouver plus tard.',$4::"ArticleStatus",$5,$6,$7,NOW(),NOW())`, [id, data.titles[index], "Contenu de lecture. ".repeat(30) + "FIN_PREMIUM_CONFIDENTIELLE", index === 22 ? "DRAFT" : "PUBLISHED", new Date(Date.now() + (index === 23 ? 86400000 : -86400000)), data.authorId, data.categoryId]);
  }
  // Telemetry must not create late references while isolated accounts are cleaned.
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
});

test.afterEach(async () => {
  if (!data) return;
  await sql(`DELETE FROM "Article" WHERE "authorId"=$1`, [data.authorId]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [data.categoryId]);
  await sql(`UPDATE "AnalyticsVisitor" SET "userId"=NULL WHERE "userId"=ANY($1::text[])`, [[data.readerId, data.authorId, data.otherId]]);
  await sql(`DELETE FROM "Author" WHERE id=ANY($1::text[])`, [[data.readerId, data.authorId, data.otherId]]);
});
test.afterAll(async () => { await closeDb(); });

async function signIn(page: Parameters<typeof login>[0]) {
  await login(page, { email: data.email, password: data.password, name: data.readerId });
}

test("sauvegarder depuis l’article, retrouver le favori et le retirer durablement", async ({ page }) => {
  await signIn(page);
  await page.goto(`/article/${data.slugs[0]}`, { waitUntil: "domcontentloaded" });
  const save = page.getByRole("button", { name: "Sauvegarder l’article", exact: true }).first();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("button", { name: "Retirer des favoris", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Article sauvegardé" })).toBeVisible();
  await expect.poll(async () => (await sqlOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "Bookmark" WHERE "readerId"=$1 AND "articleId"=$2`, [data.readerId, data.ids[0]]))?.count).toBe("1");
  await page.goto("/mon-compte", { waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "Mes lectures" }).getByRole("link", { name: "Favoris", exact: true }).click();
  await expect(page.getByRole("heading", { name: data.titles[0], exact: true })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(value => { document.documentElement.classList.toggle("dark", value === "dark"); document.documentElement.classList.toggle("light", value === "light"); }, theme);
    await page.locator("main").screenshot({ path: `tmp-results/wp39-favorites-${theme}.png` });
  }
  await page.getByRole("button", { name: "Retirer des favoris", exact: true }).click();
  await expect(page.getByRole("heading", { name: data.titles[0], exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Aucun article sauvegardé pour le moment.", { exact: false })).toBeVisible();
  expect((await sqlOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "Bookmark" WHERE "readerId"=$1`, [data.readerId]))?.count).toBe("0");
});

test("le signet d’une carte sauvegarde l’article et reste privé", async ({ page }) => {
  await sql(`INSERT INTO "ReadingHistory" (id,"readerId","articleId","readAt") VALUES ($1,$2,$3,NOW())`, [e2eId("history"), data.readerId, data.ids[0]]);
  await sql(`INSERT INTO "Bookmark" (id,"readerId","articleId") VALUES ($1,$2,$3)`, [e2eId("bookmark"), data.otherId, data.ids[1]]);
  await signIn(page);
  await page.goto("/mon-compte/historique", { waitUntil: "domcontentloaded" });
  const card = page.locator("main article").filter({ has: page.getByRole("heading", { name: data.titles[0], exact: true }) });
  const save = card.getByRole("button", { name: "Sauvegarder l’article", exact: true });
  await expect(save).toBeEnabled({ timeout: 30000 });
  await save.click();
  await expect(card.getByRole("button", { name: "Retirer des favoris", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/mon-compte/favoris", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: data.titles[0], exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: data.titles[1], exact: true })).toHaveCount(0);
});

test("l’historique garde la dernière lecture sans doublon et affiche 20 articles publiés", async ({ page }) => {
  for (let index = 0; index < 24; index++) await sql(`INSERT INTO "ReadingHistory" (id,"readerId","articleId","readAt") VALUES ($1,$2,$3,NOW()-($4 * INTERVAL '1 minute'))`, [e2eId("history"), data.readerId, data.ids[index], 30 - index]);
  await signIn(page);
  await page.goto("/mon-compte/historique", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main article")).toHaveCount(20);
  await expect(page.locator("main article h2").first()).toHaveText(data.titles[21]);
  await expect(page.getByRole("heading", { name: data.titles[22], exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: data.titles[23], exact: true })).toHaveCount(0);
  const previousRead = await sqlOne<{ readAt: Date }>(`SELECT "readAt" FROM "ReadingHistory" WHERE "readerId"=$1 AND "articleId"=$2`, [data.readerId, data.ids[0]]);
  await page.request.get(`/article/${data.slugs[0]}`, { headers: { "next-router-prefetch": "1", purpose: "prefetch" } });
  expect((await sqlOne<{ readAt: Date }>(`SELECT "readAt" FROM "ReadingHistory" WHERE "readerId"=$1 AND "articleId"=$2`, [data.readerId, data.ids[0]]))?.readAt.getTime()).toBe(previousRead?.readAt.getTime());
  await page.goto(`/article/${data.slugs[0]}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: data.titles[0], exact: true })).toBeVisible();
  await expect.poll(async () => (await sqlOne<{ recent: boolean }>(`SELECT "readAt">NOW()-INTERVAL '1 minute' AS recent FROM "ReadingHistory" WHERE "readerId"=$1 AND "articleId"=$2`, [data.readerId, data.ids[0]]))?.recent).toBe(true);
  await page.reload();
  await page.goto("/mon-compte/historique", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main article")).toHaveCount(20);
  await expect(page.locator("main article h2").first()).toHaveText(data.titles[0]);
  expect((await sqlOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "ReadingHistory" WHERE "readerId"=$1 AND "articleId"=$2`, [data.readerId, data.ids[0]]))?.count).toBe("1");
});

test("les favoris masquent les articles dépubliés et un signet ne déverrouille pas le premium", async ({ page }) => {
  await sql(`UPDATE "Article" SET "isPremium"=true WHERE id=$1`, [data.ids[0]]);
  await sql(`INSERT INTO "Bookmark" (id,"readerId","articleId") VALUES ($1,$2,$3),($4,$2,$5)`, [e2eId("bookmark"), data.readerId, data.ids[22], e2eId("bookmark"), data.ids[23]]);
  await signIn(page);
  await page.goto(`/article/${data.slugs[0]}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("FIN_PREMIUM_CONFIDENTIELLE", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Sauvegarder l’article", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Retirer des favoris", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
  await page.goto("/mon-compte/favoris", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main article")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: data.titles[0], exact: true })).toBeVisible();
  await expect(page.getByText("FIN_PREMIUM_CONFIDENTIELLE", { exact: false })).toHaveCount(0);
});

test("les pages de lecture sont privées et un visiteur n’a pas de signet actif", async ({ page }) => {
  for (const path of ["/mon-compte/favoris", "/mon-compte/historique"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/);
  }
  await page.goto(`/article/${data.slugs[0]}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: data.titles[0], exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sauvegarder l’article", exact: true })).toHaveCount(0);
  expect((await sqlOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "ReadingHistory" WHERE "articleId"=$1`, [data.ids[0]]))?.count).toBe("0");
});
