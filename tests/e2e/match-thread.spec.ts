import { expect, test } from "@playwright/test";
import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { clickActionButton, login } from "../fixtures/helpers";
import { TEST_EDITOR, TEST_READER } from "../fixtures/users";

const competitionId = e2eId("thread-competition"), homeId = e2eId("thread-home"), awayId = e2eId("thread-away"), matchId = e2eId("thread-match");
const message = `Analyse du match ${matchId}`, response = `Réponse de l’éditeur ${matchId}`;
test.describe("Discussion par match", () => {
  test.beforeAll(async () => {
    await sql('INSERT INTO "Competition"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'Thread E2E\',$1,\'football\',NOW(),NOW())', [competitionId]);
    await sql('INSERT INTO "Team"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'Maison Thread E2E\',$1,\'football\',NOW(),NOW()),($2,\'Extérieur Thread E2E\',$2,\'football\',NOW(),NOW())', [homeId, awayId]);
    await sql('INSERT INTO "Match"(id,"competitionId","homeTeamId","awayTeamId",status,"scheduledAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,\'SCHEDULED\',NOW()+INTERVAL \'2 days\',NOW(),NOW())', [matchId, competitionId, homeId, awayId]);
  });
  test.afterAll(async () => {
    try {
      await sql('DELETE FROM "Notification" WHERE "linkUrl" LIKE $1', [`/match/${matchId}?%`]);
      await sql('DELETE FROM "Match" WHERE id=$1', [matchId]);
      await sql('DELETE FROM "Team" WHERE id IN ($1,$2)', [homeId, awayId]);
      await sql('DELETE FROM "Competition" WHERE id=$1', [competitionId]);
    } finally { await closeDb(); }
  });
  test("création modérée, publication, réponse notifiée et suppression", async ({ page, browser }) => {
    await login(page, TEST_READER);
    await page.goto(`/match/${matchId}?tab=discussion`);
    await expect(page.getByRole("tab", { name: "Avant-match (0)" })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Votre commentaire", { exact: true }).fill(message);
    await clickActionButton(page, "Publier mon commentaire");
    await expect(page.getByRole("status").filter({ hasText: "Votre commentaire est en attente de modération." })).toBeVisible();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    const saved = await sqlOne<{ id: string; status: string; readerId: string }>('SELECT id,status,"readerId" FROM "MatchComment" WHERE "matchId"=$1 AND content=$2', [matchId, message]);
    expect(saved?.status).toBe("PENDING");
    const anonymous = await browser.newContext();
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/match/${matchId}?tab=discussion`);
    await expect(publicPage.getByText(message, { exact: true })).toHaveCount(0);
    await sql('UPDATE "MatchComment" SET status=\'APPROVED\' WHERE id=$1', [saved!.id]);
    await publicPage.reload();
    await expect(publicPage.getByText(message, { exact: true })).toBeVisible();
    await anonymous.close();
    const editor = await browser.newContext();
    const editorPage = await editor.newPage();
    await login(editorPage, TEST_EDITOR);
    await editorPage.goto(`/match/${matchId}?tab=discussion`);
    await editorPage.getByRole("button", { name: "Répondre", exact: true }).click();
    await editorPage.getByLabel("Votre réponse", { exact: true }).fill(response);
    await clickActionButton(editorPage, "Envoyer la réponse");
    await expect(editorPage.getByText(response, { exact: true })).toBeVisible();
    const reply = await sqlOne<{ status: string; parentId: string }>('SELECT status,"parentId" FROM "MatchComment" WHERE "matchId"=$1 AND content=$2', [matchId, response]);
    expect(reply).toMatchObject({ status: "APPROVED", parentId: saved!.id });
    const alerts = await sql('SELECT id FROM "Notification" WHERE "userId"=$1 AND type=\'COMMENT_REPLY\' AND "linkUrl" LIKE $2', [saved!.readerId, `/match/${matchId}?%`]);
    expect(alerts).toHaveLength(1);
    await editor.close();
    await page.reload();
    await clickActionButton(page, "Supprimer mon commentaire");
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    expect((await sqlOne<{ status: string }>('SELECT status FROM "MatchComment" WHERE id=$1', [saved!.id]))?.status).toBe("DELETED");
  });
  test("phase active selon le statut et sous-onglets accessibles au clavier", async ({ page }) => {
    for (const [status, label] of [["SCHEDULED", "Avant-match"], ["LIVE", "En direct"], ["FINISHED", "Après-match"]]) {
      await sql('UPDATE "Match" SET status=$1::"MatchStatus" WHERE id=$2', [status, matchId]);
      await page.goto(`/match/${matchId}?tab=discussion`);
      await expect(page.getByRole("tab", { name: new RegExp(`^${label}`) })).toHaveAttribute("aria-selected", "true");
    }
    await page.getByRole("tab", { name: /^Après-match/ }).focus();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: /^Avant-match/ })).toHaveAttribute("aria-selected", "true");
  });
});
