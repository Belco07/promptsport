import { test, expect } from "../fixtures/sports";
import { sql } from "../fixtures/db";

test("onglet Live conditionnel, score et lien vers le match", async ({page,sports:s}) => {
  await sql(`UPDATE "Match" SET status='LIVE' WHERE id=$1`,[s.matchId]);
  await page.goto('/competition/' + s.competitionId, { waitUntil: "domcontentloaded" });
  const nav=page.getByRole('navigation',{name:'Rubriques de la compétition'});
  await expect(nav.getByRole('link',{name:'Live (1)',exact:true})).toBeVisible();
  await nav.getByRole('link',{name:'Live (1)',exact:true}).click();
  await expect(page).toHaveURL(/tab=live/);
  const match=page.locator('main a[href="/match/'+s.matchId+'"]');
  await expect(match).toBeVisible();
  await match.click();
  await expect(page).toHaveURL(new RegExp('/match/'+s.matchId));
});

test("aucun onglet Live après la fin et ancienne URL redirigée", async ({page,sports:s}) => {
  await page.goto('/competition/' + s.competitionId + '?tab=live', { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp('/competition/'+s.competitionId+'\\?tab=classement'));
  await expect(page.getByRole('navigation',{name:'Rubriques de la compétition'}).getByRole('link',{name:/Live/})).toHaveCount(0);
});
