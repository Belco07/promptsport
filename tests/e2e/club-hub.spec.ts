import { expect, test } from "@playwright/test";
import { closeDb, e2eId, sql, sqlOne } from "../fixtures/db";
import { clickActionButton, login } from "../fixtures/helpers";
import { TEST_READER } from "../fixtures/users";

const competitionId = e2eId("hub-competition"), homeId = e2eId("hub-home"), awayId = e2eId("hub-away"), matchId = e2eId("hub-match"), playerId = e2eId("hub-player");
const homeSlug = homeId, awaySlug = awayId, playerName = "Joueur Hub E2E";
let readerId: string, previousFavorite: string | null;

test.describe("Hub club : club préféré et vote", () => {
  test.beforeAll(async () => {
    const reader = await sqlOne<{ id: string; favoriteClubId: string | null }>('SELECT id,"favoriteClubId" FROM "Author" WHERE email=$1', [TEST_READER.email]);
    if (!reader) throw new Error("Créer les comptes E2E avant ce test.");
    readerId = reader.id; previousFavorite = reader.favoriteClubId;
    await sql('INSERT INTO "Competition"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'Hub E2E\',$1,\'football\',NOW(),NOW())', [competitionId]);
    await sql('INSERT INTO "Team"(id,name,slug,sport,"createdAt","updatedAt") VALUES($1,\'Club Maison Hub E2E\',$1,\'football\',NOW(),NOW()),($2,\'Club Extérieur Hub E2E\',$2,\'football\',NOW(),NOW())', [homeId, awayId]);
    await sql('INSERT INTO "Player"(id,name,slug,"teamId","createdAt","updatedAt") VALUES($1,$2,$1,$3,NOW(),NOW())', [playerId, playerName, homeId]);
    await sql('INSERT INTO "Match"(id,"competitionId","homeTeamId","awayTeamId","homeScore","awayScore",status,"scheduledAt","createdAt","updatedAt") VALUES($1,$2,$3,$4,1,0,\'FINISHED\',NOW()-INTERVAL \'2 hours\',NOW(),NOW())', [matchId, competitionId, homeId, awayId]);
    await sql('INSERT INTO "MatchEvent"(id,"matchId","teamId","playerName",type,minute,"createdAt") VALUES($1,$2,$3,$4,\'GOAL\',25,NOW())', [e2eId("hub-goal"), matchId, homeId, playerName]);
  });
  test.afterAll(async () => {
    try {
      if (readerId) await sql('UPDATE "Author" SET "favoriteClubId"=$1 WHERE id=$2', [previousFavorite, readerId]);
      await sql('DELETE FROM "Match" WHERE id=$1', [matchId]);
      await sql('DELETE FROM "Player" WHERE id=$1', [playerId]);
      await sql('DELETE FROM "Team" WHERE id IN ($1,$2)', [homeId, awayId]);
      await sql('DELETE FROM "Competition" WHERE id=$1', [competitionId]);
    } finally { await closeDb(); }
  });

  test("changer de club préféré conserve les autres suivis", async ({ page }) => {
    await login(page, TEST_READER);
    await page.goto(`/club/${homeSlug}`);
    await clickActionButton(page, "Définir comme club préféré");
    await expect(page.getByRole("button", { name: "Club préféré", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 90_000 });
    await page.goto(`/club/${awaySlug}`);
    await clickActionButton(page, "Définir comme club préféré");
    await expect(page.getByRole("button", { name: "Club préféré", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 90_000 });
    const reader = await sqlOne<{ favoriteClubId: string }>('SELECT "favoriteClubId" FROM "Author" WHERE id=$1', [readerId]);
    expect(reader?.favoriteClubId).toBe(awayId);
    const follows = await sql('SELECT "B" FROM "_ReaderFollowedTeams" WHERE "A"=$1 AND "B" IN ($2,$3)', [readerId, homeId, awayId]);
    expect(follows).toHaveLength(2);
  });

  test("un lecteur vote avec les radios et voit le pourcentage", async ({ page }) => {
    await login(page, TEST_READER);
    await page.goto(`/match/${matchId}`);
    await page.getByRole("radio", { name: new RegExp(playerName) }).check();
    await clickActionButton(page, "Voter");
    await expect(page.getByText("Votre vote est enregistré.", { exact: true })).toBeVisible();
    await expect(page.getByText(/1 vote · 100/)).toBeVisible();
    await clickActionButton(page, "Modifier mon vote");
    const count = await sqlOne<{ count: string }>('SELECT count(*) FROM "ManOfTheMatchVote" WHERE "matchId"=$1 AND "readerId"=$2', [matchId, readerId]);
    expect(Number(count?.count)).toBe(1);
  });
});
