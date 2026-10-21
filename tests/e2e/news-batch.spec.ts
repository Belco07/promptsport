import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { login } from "../fixtures/helpers";

let prefix: string;
let localFixtures = false;
const password = "E2eNewsBatch-2026!pw";
test.beforeEach(async ({ page }) => {
  localFixtures = false;
  // Charge `.env` (via le fixture SQL) avant de vérifier l'URL de la base :
  // sans cette requête, Playwright ne connaît pas encore DATABASE_URL.
  await sql("SELECT 1");
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Docker local requis.");
  prefix = e2eId("news-batch");
  localFixtures = true;
  await sql(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,'ADMIN',NOW())`, [prefix, `${prefix}@example.test`, await bcrypt.hash(password, 10)]);
  await sql(`INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())`, [prefix]);
  await sql(`INSERT INTO "Theme" (id,name,slug,"createdAt","updatedAt") VALUES ($1,$1,$1,NOW(),NOW())`, [prefix]);
  await sql(`INSERT INTO "NewsSource" (id,name,type,url,active,"createdAt","updatedAt") VALUES ($1,$1,'RSS',$2,false,NOW(),NOW())`, [prefix, `https://example.test/${prefix}`]);
  for (const suffix of ["one", "two", "bad"]) {
    await sql(`INSERT INTO "NewsAlert" (id,"sourceId",title,url,content,"publishedAt","createdAt","updatedAt") VALUES ($1,$2,$1,$3,'Une actualité sportive confirmée.',NOW(),NOW(),NOW())`, [`${prefix}-${suffix}`, prefix, `https://example.test/${prefix}/${suffix}`]);
  }
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
  await page.goto("/backoffice/veille");
});
test.afterEach(async () => {
  if (!localFixtures) return;
  await sql(`DELETE FROM "Article" WHERE "authorId"=$1`, [prefix]);
  await sql(`DELETE FROM "NewsSource" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Theme" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [prefix]);
});
test.afterAll(closeDb);

test("génération sans redirection, catégorie et thème liés, puis traitement par lot", async ({ page }) => {
  test.skip(process.env.E2E_DISTRIBUTION_STUB !== "1", "Nécessite le fournisseur IA local simulé.");
  await page.getByRole("row").filter({ hasText: `${prefix}-one` }).getByRole("button", { name: "Générer avec l’IA" }).click();
  await expect(page.getByRole("status")).toHaveText("1 brouillon(s) généré(s).");
  await expect(page).toHaveURL(/\/backoffice\/veille$/);
  const article = await sqlOne<{ id: string; categoryId: string; status: string }>(`SELECT id,"categoryId",status FROM "Article" WHERE "authorId"=$1`, [prefix]);
  expect(article?.categoryId).toBe(prefix);
  expect(article?.status).toBe("DRAFT");
  expect(await sqlOne(`SELECT * FROM "_ArticleToTheme" WHERE "A"=$1 AND "B"=$2`, [article!.id, prefix])).toBeTruthy();
  await page.getByLabel(`Sélectionner ${prefix}-two`, { exact: true }).check();
  await page.getByLabel(`Sélectionner ${prefix}-bad`, { exact: true }).check();
  await page.getByRole("button", { name: "Générer les brouillons sélectionnés" }).click();
  await expect(page.getByRole("status")).toHaveText("1 brouillon(s) généré(s).");
  await expect(page.getByRole("alert").filter({ hasText: "Certains traitements" })).toContainText("Certains traitements ont échoué");
  expect((await sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM "Article" WHERE "authorId"=$1`, [prefix]))?.count).toBe(2);
  expect((await sqlOne<{ status: string }>(`SELECT status FROM "NewsAlert" WHERE id=$1`, [`${prefix}-bad`]))?.status).toBe("PENDING");
  await expect(page).toHaveURL(/\/backoffice\/veille$/);
});

test("ignorer une sélection conserve les autres alertes", async ({ page }) => {
  await page.getByLabel(`Sélectionner ${prefix}-one`, { exact: true }).check();
  await page.getByLabel(`Sélectionner ${prefix}-two`, { exact: true }).check();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Ignorer les alertes sélectionnées" }).click();
  await expect(page.getByRole("status")).toHaveText("2 alerte(s) ignorée(s).");
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-bad` })).toBeVisible();
  expect((await sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM "NewsAlert" WHERE "sourceId"=$1`, [prefix]))?.count).toBe(1);
});

test("pagine les alertes par 50", async ({ page }) => {
  // 51 alertes datées dans le futur pour occuper la totalité de la page 1,
  // devant les alertes déjà présentes dans la base locale.
  await sql(
    `INSERT INTO "NewsAlert" (id,"sourceId",title,url,content,"publishedAt","createdAt","updatedAt")
     SELECT $1 || '-page-' || lpad(g::text, 2, '0'), $1,
            $1 || '-page-' || lpad(g::text, 2, '0'),
            'https://example.test/' || $1 || '/page-' || g,
            'Une actualité sportive confirmée.',
            NOW() + (g || ' seconds')::interval, NOW(), NOW()
     FROM generate_series(0, 50) AS g`,
    [prefix],
  );
  await page.reload();

  await expect(page.getByRole("navigation", { name: "Pagination de la veille" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-page-50` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-page-00` })).toHaveCount(0);

  await page.getByRole("link", { name: "Page suivante →" }).click();
  await expect(page).toHaveURL(/\/backoffice\/veille\?page=2$/);
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-page-00` })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-page-50` })).toHaveCount(0);

  await page.getByRole("link", { name: "← Page précédente" }).click();
  await expect(page).toHaveURL(/\/backoffice\/veille$/);
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-page-50` })).toBeVisible();
});

