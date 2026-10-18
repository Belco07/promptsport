import { test, expect } from "../fixtures/sports";
import { sql } from "../fixtures/db";

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
test('BottomNav visible, navigation Scores et état actif',async({page,sports:s})=>{
  await page.goto('/club/'+s.homeId);
  const nav=page.getByRole('navigation',{name:'Navigation mobile',exact:true});
  await expect(nav).toBeVisible();
  await nav.getByRole('link',{name:'Scores',exact:true}).click();
  await expect(page).toHaveURL(/\/scores$/);
  await expect(nav.getByRole('link',{name:'Scores',exact:true})).toHaveAttribute('aria-current','page');
});
test('LiveDrawer ouvre les directs et un match rejoint sa fiche',async({page,sports:s})=>{
  await sql(`UPDATE "Match" SET status='LIVE' WHERE id=$1`,[s.matchId]);
  await page.goto('/competition/'+s.competitionId+'?tab=live');
  const trigger=page.getByRole('button',{name:'Ouvrir les matchs en direct',exact:true});
  await expect(trigger).toBeVisible({timeout:90000});
  await trigger.click();
  const drawer=page.getByRole('dialog',{name:'Matchs en direct',exact:true});
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('a[href="/match/'+s.matchId+'"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.locator('a[href="/match/'+s.matchId+'"]').click();
  await expect(page).toHaveURL(new RegExp('/match/'+s.matchId));
});
