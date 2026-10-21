import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";

import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { login, submitActionForm } from "../fixtures/helpers";

/**
 * WP43 — paramètres globaux et barre latérale du backoffice.
 *
 * Le test tourne sur la base Docker locale : il crée un ADMIN jetable, modifie
 * la ligne unique `SiteConfig`, puis restaure les valeurs d'origine.
 */

let prefix: string;
let original: {
  siteName: string;
  siteDescription: string;
  maintenanceMode: boolean;
} | null = null;

const password = "E2eSettings-2026!pw";

test.beforeAll(async () => {
  original = await sqlOne<{
    siteName: string;
    siteDescription: string;
    maintenanceMode: boolean;
  }>(
    `SELECT "siteName", "siteDescription", "maintenanceMode" FROM "SiteConfig" WHERE id = 'default'`,
  );
});

test.beforeEach(async ({ page }) => {
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") {
    throw new Error("Docker local requis.");
  }

  prefix = e2eId("settings");
  await sql(
    `INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt")
     VALUES ($1,$2,$3,$4,'ADMIN',NOW())`,
    [prefix, prefix, `${prefix}@example.test`, await bcrypt.hash(password, 10)],
  );

  await page.route("**/api/analytics/track", (route) =>
    route.fulfill({ status: 204 }),
  );
  await login(page, { email: `${prefix}@example.test`, password, name: prefix });
  await page.goto("/backoffice/settings");
});

test.afterEach(async () => {
  await sql(`DELETE FROM "Author" WHERE id=$1`, [prefix]);
});

test.afterAll(async () => {
  if (original) {
    await sql(
      `UPDATE "SiteConfig"
       SET "siteName"=$1, "siteDescription"=$2, "maintenanceMode"=$3, "updatedAt"=NOW()
       WHERE id='default'`,
      [original.siteName, original.siteDescription, original.maintenanceMode],
    );
  }
  await closeDb();
});

test("enregistre les paramètres et actualise les métadonnées", async ({ page }) => {
  const siteName = `PromptSport E2E ${prefix.slice(-6)}`;
  const siteDescription = "Description SEO configurée par le test E2E WP43.";

  await expect(page.getByRole("heading", { name: "Paramètres" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rôles" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Paramètres" })).toBeVisible();

  await page.getByLabel("Nom du site").fill(siteName);
  await page.getByLabel("Description SEO").fill(siteDescription);
  await page.getByLabel("Mode maintenance").check();
  await submitActionForm(page, "Enregistrer", /\/backoffice\/settings\?saved=1$/);

  await expect(page.getByRole("status")).toHaveText("Paramètres enregistrés.");
  const saved = await sqlOne<{
    siteName: string;
    siteDescription: string;
    maintenanceMode: boolean;
  }>(
    `SELECT "siteName", "siteDescription", "maintenanceMode" FROM "SiteConfig" WHERE id='default'`,
  );
  expect(saved).toEqual({ siteName, siteDescription, maintenanceMode: true });

  await page.goto("/backoffice/veille");
  await expect(page).toHaveTitle(new RegExp(`Veille \\| ${siteName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  // Restaure immédiatement pour ne pas laisser la configuration de test aux
  // autres specs exécutées dans le même serveur de développement.
  await page.goto("/backoffice/settings");
  await page.getByLabel("Nom du site").fill(original?.siteName ?? "PromptSport");
  await page
    .getByLabel("Description SEO")
    .fill(original?.siteDescription ?? "L'actualité sportive en continu");
  if (original?.maintenanceMode) {
    await page.getByLabel("Mode maintenance").check();
  } else {
    await page.getByLabel("Mode maintenance").uncheck();
  }
  await submitActionForm(page, "Enregistrer", /\/backoffice\/settings\?saved=1$/);
});

test("la session reste accessible en bas de la sidebar sur mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/backoffice/settings");

  const aside = page.locator("aside");
  await expect(aside).toHaveCSS("position", "sticky");

  const logout = page.getByRole("button", { name: "Se déconnecter" });
  await expect(logout).toBeVisible();
  const box = await logout.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(640);
});
