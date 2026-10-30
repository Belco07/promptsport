import { test, expect } from "@playwright/test";
import { sql, closeDb, e2eId } from "../fixtures/db";

test.afterAll(closeDb);
test("article : revenir en haut après un lien connexe, restaurer la position au retour", async ({ page }) => {
  const target = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.port !== "5432") throw Error("Docker local requis");
  const id = e2eId("article-scroll");
  await sql('INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,\'disabled-e2e-login\',\'EDITOR\',NOW())', [id, `${id}@example.test`]);
  await sql('INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())', [id]);
  for (const suffix of ["a", "b"]) await sql('INSERT INTO "Article" (id,title,slug,content,excerpt,status,"publishedAt","authorId","categoryId","createdAt","updatedAt") VALUES ($1,$1,$1,$2,\'Un article connexe.\',\'PUBLISHED\',NOW()-INTERVAL \'1 hour\',$3,$3,NOW(),NOW())', [`${id}-${suffix}`, "Un paragraphe sportif pour lire et faire défiler la page.\n\n".repeat(90), id]);
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  try {
    await page.goto(`/article/${id}-a`);
    const related = page.locator(`a[href="/article/${id}-b"]`).first();
    await related.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await related.click();
    await expect(page).toHaveURL(new RegExp(`/article/${id}-b$`));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(5);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/article/${id}-a$`));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  } finally {
    await page.goto("about:blank");
    await sql('DELETE FROM "Article" WHERE "authorId"=$1', [id]);
    await sql('DELETE FROM "Category" WHERE id=$1', [id]);
    await sql('DELETE FROM "Author" WHERE id=$1', [id]);
  }
});
