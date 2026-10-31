import { test, expect } from "../fixtures/sports";
import { sql, e2eId } from "../fixtures/db";
import { login } from "../fixtures/helpers";

test("rédaction : rechercher et associer un match avec suggestions", async ({ page, sports }) => {
  const id = e2eId("match-picker");
  try {
    await sql('UPDATE "Author" SET role=\'EDITOR\' WHERE email=$1', [sports.user.email]);
    await sql('INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())', [id]);
    await sql('INSERT INTO "Article" (id,title,slug,content,excerpt,status,"authorId","categoryId","createdAt","updatedAt") SELECT $1,$2,$1,\'Texte\',\'Extrait\',\'DRAFT\',id,$1,NOW(),NOW() FROM "Author" WHERE email=$3', [id, sports.homeName, sports.user.email]);
    await login(page, sports.user);
    await page.goto(`/studio/articles/${id}/edit`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Choisir un match", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Match associé" });
    await dialog.getByRole("searchbox").fill(sports.homeName);
    const option = dialog.getByRole("button", { name: new RegExp(sports.homeName) });
    await expect(option).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Suggestions", exact: true })).toBeVisible();
    await expect(dialog.getByText("Impossible de charger les matchs", { exact: false })).toHaveCount(0);
    await option.click();
    await expect(page.locator('input[name="matchId"]')).toHaveValue(sports.matchId);
  } finally {
    await sql('DELETE FROM "Article" WHERE id=$1', [id]);
    await sql('DELETE FROM "Category" WHERE id=$1', [id]);
  }
});
