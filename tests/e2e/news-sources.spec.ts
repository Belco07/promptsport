import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";

import { closeDb, e2eId, sql } from "../fixtures/db";
import { login } from "../fixtures/helpers";

/**
 * Vérifie le marqueur éditorial des sources officielles dans les deux écrans
 * de la veille : la liste des alertes et l'administration des sources.
 */

let prefix: string;
let localFixtures = false;
const password = "E2eNewsSources-2026!pw";

test.beforeEach(async ({ page }) => {
  localFixtures = false;
  await sql("SELECT 1");
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") {
    throw Error("Docker local requis.");
  }
  prefix = e2eId("news-sources");
  localFixtures = true;

  await sql(
    `INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt")
     VALUES ($1,$1,$2,$3,'ADMIN',NOW())`,
    [prefix, `${prefix}@example.test`, await bcrypt.hash(password, 10)],
  );
  await sql(
    `INSERT INTO "NewsSource" (id,name,type,url,active,"isOfficial","createdAt","updatedAt")
     VALUES ($1,$2,'OFFICIAL_SITE',$3,true,true,NOW(),NOW())`,
    [`${prefix}-source`, prefix, `https://example.test/${prefix}`],
  );
  await sql(
    `INSERT INTO "NewsAlert" (id,"sourceId",title,url,content,"publishedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'Une actualité officielle.',NOW(),NOW(),NOW())`,
    [`${prefix}-alert`, `${prefix}-source`, prefix, `https://example.test/${prefix}/article`],
  );

  await page.route("**/api/analytics/track", (route) => route.fulfill({ status: 204 }));
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
});

test.afterEach(async () => {
  if (!localFixtures) return;
  await sql(`DELETE FROM "NewsAlert" WHERE "sourceId"=$1`, [`${prefix}-source`]);
  await sql(`DELETE FROM "NewsSource" WHERE id=$1`, [`${prefix}-source`]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [prefix]);
});

test.afterAll(closeDb);

test("affiche le badge Officiel dans la veille et dans les sources", async ({ page }) => {
  await page.goto("/backoffice/veille");
  const alertRow = page.getByRole("row").filter({ hasText: prefix }).first();
  await expect(alertRow).toBeVisible();
  await expect(alertRow.getByText("Officiel", { exact: true })).toBeVisible();
  await expect(alertRow.getByText("Site officiel", { exact: true })).toBeVisible();
  await expect(page.getByText("Sources officielles", { exact: true })).toBeVisible();

  await page.goto("/backoffice/veille/sources");
  const sourceRow = page.getByRole("row").filter({ hasText: prefix }).first();
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow.getByText("Officiel", { exact: true })).toBeVisible();
  await expect(sourceRow.getByText("Site officiel", { exact: true })).toBeVisible();
});
