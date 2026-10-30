import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { closeDb, e2eId, sql } from "../fixtures/db";
import { login, expectNoBlockingA11yViolations } from "../fixtures/helpers";

let prefix: string;
const password = "E2eTimeline-2026!pw";
test.beforeEach(async () => {
  prefix = e2eId("timeline");
  await sql(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,'ADMIN',NOW())`, [prefix, `${prefix}@example.test`, await bcrypt.hash(password, 10)]);
  await sql(`INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())`, [prefix]);
  await sql(`INSERT INTO "NewsSource" (id,name,type,url,active,"createdAt","updatedAt") VALUES ($1,$1,'RSS',$2,false,NOW(),NOW())`, [prefix, `https://example.test/${prefix}`]);
  for (const suffix of ["rated", "unrated"]) await sql(`INSERT INTO "NewsAlert" (id,"sourceId",title,url,"publishedAt","viralScore","createdAt","updatedAt") VALUES ($1,$2,$3,$4,NOW(),$5,NOW(),NOW())`, [`${prefix}-${suffix}`, prefix, `${prefix} ${suffix}`, `https://example.test/${prefix}/${suffix}`, suffix === "rated" ? 5 : null]);
  await sql(`INSERT INTO "Article" (id,title,slug,content,excerpt,format,status,"authorId","categoryId","publishedAt","createdAt","updatedAt") VALUES ($1,$1,$1,'Contenu du flash de test.','Une brève de test.','FLASH','PUBLISHED',$1,$1,NOW(),NOW(),NOW())`, [prefix]);
});
test.afterEach(async () => {
  await sql(`DELETE FROM "AnalyticsPageView" WHERE "articleId"=$1`, [prefix]);
  await sql(`DELETE FROM "Article" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "NewsSource" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [prefix]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [prefix]);
});
test.afterAll(closeDb);

test("veille : score, absence de score, catégorie et sélection sur mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
  await page.goto("/backoffice/veille");
  await page.locator('[data-veille-ready="true"]').waitFor({ state: "attached", timeout: 120_000 });
  await page.getByRole("button", { name: "Timeline" }).click();
  const rated = page.locator(`[data-alert-id="${prefix}-rated"]`);
  await expect(rated.getByLabel("Viralité 5 sur 5")).toContainText("🔥🔥🔥🔥🔥");
  await expect(page.locator(`[data-alert-id="${prefix}-unrated"]`).getByLabel("Viralité non évaluée")).toContainText("Non évaluée");
  await expect(rated.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(rated.getByText(prefix, { exact: true }).first()).toBeVisible();
  await rated.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Générer les alertes 5 🔥 sélectionnées" })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expectNoBlockingA11yViolations(page, "Veille timeline sombre");
  await page.screenshot({ path: test.info().outputPath("veille-mobile.png"), fullPage: false });
  const bounds = await rated.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.width).toBeGreaterThan(250);
  await page.getByText("Menu du backoffice", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
});

test("fil public : heure, badge, titre lié et ligne verticale", async ({ page }) => {
  test.setTimeout(180_000);
  const wire = page.getByRole("list", { name: "Dernières brèves" });
  const row = wire.getByRole("listitem").filter({ has: page.getByRole("link", { name: prefix, exact: true }) });
  // L'accueil est mis en cache 60 s : recharger jusqu'à ce que la brève
  // insérée en base apparaisse, au lieu de dépendre du moment du warmup.
  await expect(async () => {
    await page.goto("/");
    await expect(row).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [5_000] });
  await expect(row.locator("time")).toHaveText(/^\d{2}:\d{2}$/);
  await expect(row.getByText(prefix, { exact: true }).first()).toBeVisible();
  await expect(wire).toHaveCSS("border-left-width", "1px");
  await expectNoBlockingA11yViolations(page, "Accueil Fil Info");
  await wire.screenshot({ path: test.info().outputPath("fil-info.png") });
  await row.getByRole("link", { name: prefix, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/article/${prefix}$`));
});
