import { test, expect } from "../fixtures/sports";
import { sqlOne } from "../fixtures/db";
import { clickActionButton, login } from "../fixtures/helpers";

test("suivre un club le rend visible dans Mon Sport", async ({ page, sports: s }) => {
  await login(page, s.user);
  await page.goto('/club/' + s.homeId);
  await clickActionButton(page, 'Suivre ' + s.homeName);
  const followed = page.getByRole('button', { name: 'Ne plus suivre ' + s.homeName, exact: true });
  await expect(followed).toHaveText('Suivi');
  await expect(followed).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/mon-sport');
  await expect(page.getByRole('heading', {name:'Mes favoris'})).toBeVisible();
  await expect(page.getByRole('listitem').filter({has: page.getByRole('button', {name:'Ne plus suivre ' + s.homeName,exact:true})})).toContainText(s.homeName);
});

test("un club préféré conserve les autres suivis", async ({ page, sports: s }) => {
  await login(page, s.user);
  for (const id of [s.homeId, s.awayId]) {
    await page.goto('/club/' + id);
    await clickActionButton(page, 'Définir comme club préféré');
    await expect(page.getByRole('button', {name:'Club préféré',exact:true})).toHaveAttribute('aria-pressed','true');
  }
  const reader = await sqlOne<{id:string; favoriteClubId:string}>('SELECT id,"favoriteClubId" FROM "Author" WHERE email=$1',[s.user.email]);
  expect(reader?.favoriteClubId).toBe(s.awayId);
  const count = await sqlOne<{count:string}>('SELECT count(*) FROM "_ReaderFollowedTeams" WHERE "A"=$1 AND "B" IN ($2,$3)',[reader!.id,s.homeId,s.awayId]);
  expect(Number(count?.count)).toBe(2);
});

test("un vote homme du match reste unique après modification", async ({ page, sports: s }) => {
  await login(page, s.user);
  await page.goto('/match/' + s.matchId);
  await page.getByRole('radio',{name:new RegExp(s.playerName)}).check();
  await clickActionButton(page,'Voter');
  await expect(page.getByText('Votre vote est enregistré.',{exact:true})).toBeVisible();
  await expect(page.getByText(/1 vote · 100/)).toBeVisible();
  await clickActionButton(page,'Modifier mon vote');
  const count=await sqlOne<{count:string}>('SELECT count(*) FROM "ManOfTheMatchVote" WHERE "matchId"=$1',[s.matchId]);
  expect(Number(count?.count)).toBe(1);
});
