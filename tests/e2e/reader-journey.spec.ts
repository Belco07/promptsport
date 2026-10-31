import { expect, test } from "@playwright/test";
import { closeDb, e2eId, sql } from "../fixtures/db";
import { login } from "../fixtures/helpers";
import { TEST_READER } from "../fixtures/users";

const competitionId = e2eId("journey-competition"), homeId = e2eId("journey-home"), awayId = e2eId("journey-away"), matchId = e2eId("journey-match");
test.describe("Parcours réel du lecteur", () => {
  test.beforeAll(async () => {
    await sql('INSERT INTO "Competition"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'Compétition Parcours E2E\',$1,\'football\',NOW(),NOW())', [competitionId]);
    await sql('INSERT INTO "Team"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'ParcoursHomeE2E\',$1,\'football\',NOW(),NOW()),($2,\'ParcoursAwayE2E\',$2,\'football\',NOW(),NOW())', [homeId, awayId]);
    await sql('INSERT INTO "Match"(id,"competitionId","homeTeamId","awayTeamId",status,"homeScore","awayScore","scheduledAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,\'FINISHED\',2,1,NOW()-INTERVAL \'2 hours\',NOW(),NOW())', [matchId, competitionId, homeId, awayId]);
  });
  test.afterAll(async () => {
    try {
      await sql('DELETE FROM "Match" WHERE id=$1', [matchId]);
      await sql('DELETE FROM "Team" WHERE id IN ($1,$2)', [homeId, awayId]);
      await sql('DELETE FROM "Competition" WHERE id=$1', [competitionId]);
    } finally { await closeDb(); }
  });

  test("Mon Sport reste accessible après Scores puis un match, avec les filtres et le retour arrière", async ({ page }) => {
    await login(page, TEST_READER);
    await page.goto("/mon-sport", { waitUntil: "domcontentloaded" });
    const trail = page.locator("nav[data-breadcrumb]:visible");
    await expect(trail.locator("[aria-current=page]")).toHaveText("Mon Sport");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("promptsport:reader-journey:v1") ?? "{}").steps?.[0]?.href)).toBe("/mon-sport");
    await page.goto("/scores?view=finished&q=ParcoursHomeE2E", { waitUntil: "domcontentloaded" });
    await expect(trail.getByRole("link", { name: "Mon Sport", exact: true })).toBeVisible();
    await page.locator(`a[href="/match/${matchId}"]`).first().click();
    await expect(trail.locator("[aria-current=page]")).toHaveText("ParcoursHomeE2E — ParcoursAwayE2E");
    await expect(trail.getByRole("link", { name: "Mon Sport", exact: true })).toHaveAttribute("href", "/mon-sport");
    await expect(trail.getByRole("link", { name: "Scores", exact: true })).toHaveAttribute("href", "/scores?q=ParcoursHomeE2E&view=finished");
    await expect(trail.getByRole("link", { name: "Accueil", exact: true })).toHaveCount(0);
    await expect(trail.getByRole("link", { name: "Compétition Parcours E2E", exact: true })).toHaveCount(0);
    const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.flatMap(node => { try { const value = JSON.parse(node.textContent ?? "null"); return value?.["@type"] === "BreadcrumbList" ? [value] : []; } catch { return []; } }));
    expect(schemas[0].itemListElement.map((item: { name: string }) => item.name)).not.toContain("Mon Sport");
    await page.goBack();
    await expect(trail.locator("[aria-current=page]")).toHaveText("Scores");
    await expect(trail.getByRole("link", { name: "Mon Sport", exact: true })).toBeVisible();
    await page.goForward();
    await expect(trail.getByRole("link", { name: "Scores", exact: true })).toBeVisible();
    await page.locator(`a[href="/club/${homeId}"]`).first().click();
    await expect(trail.locator("[aria-current=page]")).toHaveText("ParcoursHomeE2E");
    await expect(trail.getByRole("link", { name: "ParcoursHomeE2E — ParcoursAwayE2E", exact: true })).toHaveAttribute("href", `/match/${matchId}`);
    await trail.getByRole("link", { name: "Mon Sport", exact: true }).click();
    await expect(page).toHaveURL(/\/mon-sport$/);
    await expect(trail.getByRole("link", { name: "Scores", exact: true })).toHaveCount(0);
    await page.reload();
    await expect(trail.locator("[aria-current=page]")).toHaveText("Mon Sport");
  });

  test("une nouvelle session commence sur sa page réelle sans emprunter le parcours d’un autre lecteur", async ({ page }) => {
    await page.goto(`/match/${matchId}`, { waitUntil: "domcontentloaded" });
    const trail = page.locator("nav[data-breadcrumb]:visible");
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("promptsport:reader-journey:v1") ?? "{}").steps?.length)).toBe(1);
    await expect(trail.getByRole("link")).toHaveCount(0);
    await expect(trail.locator("[aria-current=page]")).toHaveText("ParcoursHomeE2E — ParcoursAwayE2E");
  });
});
