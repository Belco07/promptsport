import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { login } from "../fixtures/helpers";

let prefix: string;
let localFixtures = false;
const password = "E2eDistribution-2026!pw";

test.beforeEach(async ({ page }) => {
  localFixtures = false;
  try { process.loadEnvFile(); } catch { /* Environment provided by the runner. */ }
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Local Docker required.");
  prefix = e2eId("distribution");
  localFixtures = true;
  await sql(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,'EDITOR',NOW())`, [prefix, `${prefix}@example.test`, await bcrypt.hash(password, 10)]);
  await sql(`INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())`, [prefix]);
  await sql(`INSERT INTO "Article" (id,title,slug,content,excerpt,status,"coverImageUrl","authorId","categoryId","createdAt","updatedAt") VALUES ($1,$1,$1,'Un article sportif de test.','Un résumé factuel.','DRAFT','/promptsport-og.png',$1,$1,NOW(),NOW())`, [prefix]);
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
});
test.afterEach(async () => {
  if (!localFixtures) return;
  await sql(`DELETE FROM "Article" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [prefix]);
});
test.afterAll(closeDb);

test("diffusion : copie et suivi des trois réseaux sans doublon", async ({ page, context }) => {
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
  if (process.env.E2E_DISTRIBUTION_STUB === "1") {
    // Le runner local fournit l'IA simulée : tester aussi la publication réelle.
    await page.goto("/studio/articles");
    const row = page.getByRole("row").filter({ hasText: prefix });
    await row.getByLabel("Statut de l'article").selectOption("PUBLISHED");
  } else {
    // La suite standard reste indépendante d'une clé IA et ne consomme rien.
    await sql(`UPDATE "Article" SET status='PUBLISHED',"publishedAt"=NOW() WHERE id=$1`, [prefix]);
    for (const platform of ["X", "FACEBOOK", "INSTAGRAM"]) await sql(`INSERT INTO "SocialPost" (id,"articleId",platform,content) VALUES ($1,$2,$3::"SocialPlatform",$4)`, [`${prefix}-${platform}`, prefix, platform, `Une actualité sportive. #Sport\n\nhttp://localhost/article/${prefix}`]);
  }
  await expect.poll(async () => (await sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM "SocialPost" WHERE "articleId"=$1`, [prefix]))?.count, { timeout: 60000 }).toBe(3);
  await page.goto(`/studio/articles/${prefix}/edit`);
  await page.getByRole("link", { name: "Diffusion", exact: true }).click();
  const x = page.getByRole("region", { name: "Post X", exact: true });
  const facebook = page.getByRole("region", { name: "Post Facebook", exact: true });
  const instagram = page.getByRole("region", { name: "Post Instagram", exact: true });
  await expect(x).toContainText(`/article/${prefix}`);
  await expect(instagram).toContainText(`/article/${prefix}`);
  await expect(facebook).toContainText("#Sport");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await x.getByRole("button", { name: "Copier le texte X", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Texte X copié.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/article/${prefix}`);
  await x.getByRole("button", { name: "Marquer comme publié sur X", exact: true }).click();
  await expect(x.getByText("Publié", { exact: true })).toBeVisible();
  await page.reload();
  await expect(x.getByText("Publié", { exact: true })).toBeVisible();
  await expect(facebook.getByText("Validation requise", { exact: true })).toBeVisible();
  expect((await sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM "SocialPost" WHERE "articleId"=$1`, [prefix]))?.count).toBe(3);
});

test("la diffusion reste invisible pour un brouillon et inaccessible sans session", async ({ page, browser }) => {
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
  await page.goto(`/studio/articles/${prefix}/edit?tab=diffusion`);
  await expect(page.getByRole("link", { name: "Diffusion", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Diffusion sociale" })).toHaveCount(0);
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto(`/studio/articles/${prefix}/edit?tab=diffusion`);
    await expect(visitor).toHaveURL(/\/login/);
  } finally { await anonymous.close(); }
});
