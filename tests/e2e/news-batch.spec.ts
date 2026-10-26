import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { login } from "../fixtures/helpers";

// La machine de développement peut être très lente à compiler et à hydrater
// les pages ; les parcours restent bornés mais disposent d'une marge réaliste.
test.describe.configure({ timeout: 300_000 });

/** Attend que les boutons client de la veille soient hydratés. */
async function waitForVeilleHydration(page: Page): Promise<void> {
  await page
    .locator('[data-veille-ready="true"]')
    .waitFor({ state: "attached", timeout: 120_000 });
}

/** Supprime les couvertures générées en local par la composition d'image. */
async function removeLocalCovers(): Promise<void> {
  const rows = await sql<{ coverImageUrl: string | null }>(
    `SELECT "coverImageUrl" FROM "Article" WHERE "authorId"=$1`,
    [prefix],
  );
  for (const row of rows) {
    if (!row.coverImageUrl?.startsWith("/uploads/")) continue;
    try {
      await unlink(
        path.join(process.cwd(), "public", row.coverImageUrl.replace(/^\/+/, "")),
      );
    } catch {
      // Fichier absent ou stockage distant : rien à supprimer.
    }
  }
}

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
    await sql(`INSERT INTO "NewsAlert" (id,"sourceId",title,url,content,"publishedAt","viralScore","createdAt","updatedAt") VALUES ($1,$2,$1,$3,'Une actualité sportive confirmée.',NOW(),5,NOW(),NOW())`, [`${prefix}-${suffix}`, prefix, `https://example.test/${prefix}/${suffix}`]);
  }
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
  await page.goto("/backoffice/veille");
  await waitForVeilleHydration(page);
});
test.afterEach(async () => {
  if (!localFixtures) return;
  await removeLocalCovers();
  await sql(`DELETE FROM "Article" WHERE "authorId"=$1`, [prefix]);
  await sql(`DELETE FROM "NewsSource" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Theme" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [prefix]);
});
test.afterAll(closeDb);

test("génération sans redirection, catégorie et thème liés, puis traitement par lot", async ({ page }) => {
  test.skip(process.env.E2E_DISTRIBUTION_STUB !== "1", "Nécessite le fournisseur IA local simulé.");
  await page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` }).getByRole("button", { name: "Générer avec l’IA" }).click();
  await expect(page.getByRole("status")).toHaveText("1 brouillon(s) généré(s).");
  await expect(page).toHaveURL(/\/backoffice\/veille$/);
  const article = await sqlOne<{ id: string; categoryId: string; status: string }>(`SELECT id,"categoryId",status FROM "Article" WHERE "authorId"=$1`, [prefix]);
  expect(article?.categoryId).toBe(prefix);
  expect(article?.status).toBe("DRAFT");
  expect(await sqlOne(`SELECT * FROM "_ArticleToTheme" WHERE "A"=$1 AND "B"=$2`, [article!.id, prefix])).toBeTruthy();
  await page.getByLabel(`Sélectionner ${prefix}-two`, { exact: true }).check();
  await page.getByLabel(`Sélectionner ${prefix}-bad`, { exact: true }).check();
  await page.getByRole("button", { name: "Générer les alertes sélectionnées" }).click();
  await expect(page.getByRole("status")).toHaveText("1 brouillon(s) généré(s).");
  await expect(page.getByRole("alert").filter({ hasText: "Certains traitements" })).toContainText("Certains traitements ont échoué");
  expect((await sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM "Article" WHERE "authorId"=$1`, [prefix]))?.count).toBe(2);
  expect((await sqlOne<{ status: string }>(`SELECT status FROM "NewsAlert" WHERE id=$1`, [`${prefix}-bad`]))?.status).toBe("PENDING");
  await expect(page).toHaveURL(/\/backoffice\/veille$/);
});

test("publie automatiquement une alerte 5 d’une source fiable, autorisée et illustrée", async ({ page }) => {
  test.skip(process.env.E2E_DISTRIBUTION_STUB !== "1", "Nécessite le fournisseur IA local simulé.");
  const origin = new URL(page.url()).origin;
  await sql(
    `UPDATE "NewsSource" SET "autoPublish"=true, reliability=95, "imagePolicy"='LICENSED' WHERE id=$1`,
    [prefix],
  );
  await sql(`UPDATE "NewsAlert" SET "imageUrl"=$2 WHERE id=$1`, [
    `${prefix}-one`,
    `${origin}/promptsport-og.png`,
  ]);
  await page.reload();
  await waitForVeilleHydration(page);
  await page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` }).getByRole("button", { name: "Générer avec l’IA" }).click();
  await expect(page.getByRole("status")).toHaveText("1 article(s) publié(s) automatiquement.", {
    timeout: 90_000,
  });
  const article = await sqlOne<{
    status: string;
    publishedAt: Date | null;
    coverImageUrl: string | null;
    coverImageCredit: string | null;
    coverImageCreditUrl: string | null;
  }>(
    `SELECT status,"publishedAt","coverImageUrl","coverImageCredit","coverImageCreditUrl"
     FROM "Article" WHERE "authorId"=$1`,
    [prefix],
  );
  expect(article?.status).toBe("PUBLISHED");
  expect(article?.publishedAt).toBeTruthy();
  expect(article?.coverImageUrl).toMatch(/^\/uploads\/.+\.jpg$/);
  expect(article?.coverImageCredit).toBe(prefix);
  expect(article?.coverImageCreditUrl).toBe(`https://example.test/${prefix}/one`);
  expect((await sqlOne<{ count: number }>(`SELECT count(*)::int AS count FROM "Article" WHERE "authorId"=$1`, [prefix]))?.count).toBe(1);
  expect((await sqlOne<{ status: string }>(`SELECT status FROM "NewsAlert" WHERE id=$1`, [`${prefix}-one`]))?.status).toBe("DRAFT_GENERATED");
});

test("édite le visuel d’une source non licenciée avant de publier", async ({ page }) => {
  test.skip(process.env.E2E_DISTRIBUTION_STUB !== "1", "Nécessite le fournisseur IA local simulé.");
  const origin = new URL(page.url()).origin;
  // Source fiable, auto-publiable et non licenciée : le visuel est brandé.
  await sql(
    `UPDATE "NewsSource" SET "autoPublish"=true, reliability=95, "imagePolicy"='REFERENCE_ONLY' WHERE id=$1`,
    [prefix],
  );
  await sql(`UPDATE "NewsAlert" SET "imageUrl"=$2 WHERE id=$1`, [
    `${prefix}-one`,
    `${origin}/promptsport-og.png`,
  ]);
  await page.reload();
  await waitForVeilleHydration(page);
  await page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` }).getByRole("button", { name: "Générer avec l’IA" }).click();
  await expect(page.getByRole("status")).toHaveText("1 article(s) publié(s) automatiquement.", {
    timeout: 90_000,
  });
  const article = await sqlOne<{ status: string; coverImageUrl: string | null; coverImageCreditUrl: string | null }>(
    `SELECT status,"coverImageUrl","coverImageCreditUrl" FROM "Article" WHERE "authorId"=$1`,
    [prefix],
  );
  expect(article?.status).toBe("PUBLISHED");
  expect(article?.coverImageUrl).toMatch(/^\/uploads\/.+\.jpg$/);
  expect(article?.coverImageCreditUrl).toBe(`https://example.test/${prefix}/one`);
});

test("conserve le brouillon si la source auto-publiable n’a aucun visuel exploitable", async ({ page }) => {
  test.skip(process.env.E2E_DISTRIBUTION_STUB !== "1", "Nécessite le fournisseur IA local simulé.");
  // Source fiable et auto-publiable, mais aucune image dans l'alerte ni sur la page.
  await sql(`UPDATE "NewsSource" SET "autoPublish"=true, reliability=95 WHERE id=$1`, [prefix]);
  await page.reload();
  await waitForVeilleHydration(page);
  await page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` }).getByRole("button", { name: "Générer avec l’IA" }).click();
  await expect(page.getByRole("status")).toContainText("sans photo source exploitable", {
    timeout: 90_000,
  });
  const article = await sqlOne<{ status: string; coverImageUrl: string | null }>(
    `SELECT status,"coverImageUrl" FROM "Article" WHERE "authorId"=$1`,
    [prefix],
  );
  expect(article?.status).toBe("DRAFT");
  expect(article?.coverImageUrl).toBeNull();
});

test("génère manuellement une alerte de score inférieur à 5", async ({ page }) => {
  test.skip(process.env.E2E_DISTRIBUTION_STUB !== "1", "Nécessite le fournisseur IA local simulé.");
  await sql(`UPDATE "NewsAlert" SET "viralScore"=4 WHERE id=$1`, [`${prefix}-one`]);
  await page.reload();
  await waitForVeilleHydration(page);
  const row = page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` });
  await expect(row.getByText("4/5")).toBeVisible();
  await expect(row.getByRole("button", { name: "Générer avec l’IA" })).toBeEnabled();
  await row.getByRole("button", { name: "Générer avec l’IA" }).click();
  await expect(page.getByRole("status")).toHaveText("1 brouillon(s) généré(s).");
  const article = await sqlOne<{ status: string; format: string }>(
    `SELECT status, format FROM "Article" WHERE "authorId"=$1`,
    [prefix],
  );
  expect(article?.status).toBe("DRAFT");
  expect(["FLASH", "NEWS", "ANALYSIS"]).toContain(article?.format);
});

test("bascule entre tableau et timeline sans perdre les alertes", async ({ page }) => {
  await expect(page.getByRole("table", { name: /vue tableau/i })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Visuel / licence" })).toBeVisible();
  await page.getByRole("button", { name: "Timeline" }).click();
  await expect(page.getByRole("list", { name: "Alertes de veille éditoriale" })).toBeVisible();
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` })).toBeVisible();
  await page.getByRole("button", { name: "Tableau" }).click();
  await expect(page.getByRole("table", { name: /vue tableau/i })).toBeVisible();
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` })).toBeVisible();
});

test("nettoie toutes les alertes non virales en un clic", async ({ page }) => {
  await sql(`UPDATE "NewsAlert" SET "viralScore"=4 WHERE id = ANY($1::text[])`, [
    [`${prefix}-one`, `${prefix}-two`],
  ]);
  await page.reload();
  await waitForVeilleHydration(page);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Nettoyer les alertes non-virales" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "non virale(s) supprimée(s)" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` })).toHaveCount(0);
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-two` })).toHaveCount(0);
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-bad` })).toBeVisible();
  expect(
    (await sqlOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM "NewsAlert" WHERE id = ANY($1::text[]) AND "viralScore" < 5`,
      [[`${prefix}-one`, `${prefix}-two`]],
    ))?.count,
  ).toBe(0);
});

test("affiche le quota restant et bloque la génération à zéro", async ({ page }) => {
  await sql(
    `INSERT INTO "Article" (id,title,slug,content,excerpt,status,"authorId","categoryId","newsSourceId","createdAt","updatedAt")
     SELECT $1 || '-quota-' || g, 'Quota ' || g, $1 || '-quota-' || g, 'Contenu', 'Extrait', 'DRAFT', $1, $1, $2, NOW(), NOW()
     FROM generate_series(1, 15) AS g`,
    [prefix, prefix],
  );
  await page.reload();
  await waitForVeilleHydration(page);
  await expect(page.getByText("0/15", { exact: true })).toBeVisible();
  await expect(page.getByText("Quota IA atteint pour aujourd'hui.").first()).toBeVisible();
  await expect(
    page.locator("[data-alert-id]").filter({ hasText: `${prefix}-one` }).getByRole("button", { name: "Générer avec l’IA" }),
  ).toBeDisabled();
});

test("ignorer une sélection conserve les autres alertes", async ({ page }) => {
  await page.getByLabel(`Sélectionner ${prefix}-one`, { exact: true }).check();
  await page.getByLabel(`Sélectionner ${prefix}-two`, { exact: true }).check();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Ignorer les alertes sélectionnées" }).click();
  await expect(page.getByRole("status")).toHaveText("2 alerte(s) ignorée(s).");
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-bad` })).toBeVisible();
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
  await waitForVeilleHydration(page);

  await expect(page.getByRole("navigation", { name: "Pagination de la veille" })).toBeVisible();
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-page-50` })).toBeVisible();
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-page-00` })).toHaveCount(0);

  await page.getByRole("link", { name: "Page suivante →" }).click();
  await expect(page).toHaveURL(/\/backoffice\/veille\?page=2$/, {
    timeout: 90_000,
  });
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-page-00` })).toBeVisible();
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-page-50` })).toHaveCount(0);

  await page.getByRole("link", { name: "← Page précédente" }).click();
  await expect(page).toHaveURL(/\/backoffice\/veille$/, { timeout: 90_000 });
  await expect(page.locator("[data-alert-id]").filter({ hasText: `${prefix}-page-50` })).toBeVisible();
});
