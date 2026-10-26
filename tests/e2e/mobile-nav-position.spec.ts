import { test, expect } from "../fixtures/sports";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("la navigation reste au bas de l'écran malgré le conteneur et le défilement", async ({ page, sports }) => {
  await page.goto(`/club/${sports.homeId}`);
  const nav = page.getByRole("navigation", { name: "Navigation mobile", exact: true });
  await expect(nav).toBeVisible();
  // Reproduce a containing block created by page styling or an embedded widget.
  await page.locator(".public-site").evaluate(element => {
    Object.assign((element as HTMLElement).style, { transform: "translateZ(0)", minHeight: "3000px", overflow: "clip" });
  });
  for (const height of [844, 650, 844]) {
    await page.setViewportSize({ width: 390, height });
    for (const y of [0, 800, 1800, 0]) {
      await page.evaluate(y => window.scrollTo({ top: y, behavior: "instant" }), y);
      await expect.poll(() => nav.evaluate(element => Math.abs(element.getBoundingClientRect().bottom - window.innerHeight))).toBeLessThanOrEqual(1);
      await expect(nav.getByRole("link", { name: "Scores", exact: true })).toBeInViewport();
    }
  }
  await nav.getByRole("link", { name: "Scores", exact: true }).click();
  await expect(page).toHaveURL(/\/scores$/);
});
