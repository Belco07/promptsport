import { test, expect } from "../fixtures/sports";
import { sql } from "../fixtures/db";
import { login, expectNoBlockingA11yViolations } from "../fixtures/helpers";
for (const section of ['mon-sport','club','live','themes'] as const) {
  test('accessibilité serious + critical : '+section, async ({page,sports:s}) => {
    if(section==='mon-sport') await login(page,s.user);
    if(section==='live') await sql(`UPDATE "Match" SET status='LIVE' WHERE id=$1`,[s.matchId]);
    const path=section==='club'?'/club/'+s.homeId:section==='live'?'/competition/'+s.competitionId+'?tab=live':'/'+section;
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expectNoBlockingA11yViolations(page,path);
  });
}
