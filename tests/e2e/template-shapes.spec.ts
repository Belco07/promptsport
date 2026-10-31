import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { sql, closeDb, e2eId } from "../fixtures/db";
import { login } from "../fixtures/helpers";

test.afterAll(closeDb);
test("Template : couleurs et bordures conservées après enregistrement", async ({ page }, testInfo) => {
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Docker local requis");
  const id = e2eId("shape-style"), password = "ShapeStyle-2026!";
  await sql('INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,\'ADMIN\',NOW())', [id, `${id}@example.test`, await bcrypt.hash(password, 10)]);
  try {
    await login(page, { email: `${id}@example.test`, password, name: id });
    await page.goto("/studio/templates?new=1", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Formes et calques/ }).click();
    await page.getByRole("button", { name: "Rectangle", exact: true }).click();
    await expect(page.getByLabel("Couleur de remplissage", { exact: true })).toBeEnabled();
    await page.getByLabel("Couleur de remplissage", { exact: true }).fill("#123456");
    await page.getByLabel("Couleur de bordure", { exact: true }).fill("#ef1234");
    await page.getByLabel("Épaisseur de bordure", { exact: true }).fill("8");
    await page.getByLabel("Style de bordure", { exact: true }).selectOption("dashed");
    await page.getByRole("button", { name: "Cercle", exact: true }).click();
    await page.getByLabel("Sans remplissage", { exact: true }).check();
    await page.getByLabel("Couleur de bordure", { exact: true }).fill("#00aa55");
    await page.getByLabel("Épaisseur de bordure", { exact: true }).fill("5");
    await page.getByLabel("Style de bordure", { exact: true }).selectOption("dotted");
    await page.getByRole("group", { name: "Apparence de la forme", exact: true }).screenshot({ path: testInfo.outputPath("shape-style-controls.png") });
    await page.getByRole("button", { name: /Modèle et format/ }).click();
    await page.getByLabel("Nom du template", { exact: true }).fill(id);
    await page.getByRole("button", { name: "Enregistrer le template", exact: true }).click();
    await expect(page).toHaveURL(/template=[^&]+&saved=1/);
    const templateId = new URL(page.url()).searchParams.get("template");
    const [{ document }] = await sql<{ document: { objects: { type: string; fill: string; stroke: string; strokeWidth: number; strokeDashArray: number[]; selectable: boolean }[] } }>('SELECT document FROM "VisualTemplate" WHERE id=$1', [templateId]);
    expect(document.objects.find(item => item.type.toLowerCase() === "rect" && item.fill === "#123456")).toMatchObject({ fill: "#123456", stroke: expect.stringMatching(/^#ef1234$/i), strokeWidth: 8, strokeDashArray: [12, 8], selectable: false });
    expect(document.objects.find(item => item.type.toLowerCase() === "circle")).toMatchObject({ fill: "transparent", stroke: expect.stringMatching(/^#00aa55$/i), strokeWidth: 5, strokeDashArray: [1, 6], selectable: false });
    await page.getByRole("button", { name: /Formes et calques/ }).click();
    await page.getByRole("button", { name: "Forme / dégradé", exact: true }).nth(1).click();
    await expect(page.getByLabel("Couleur de remplissage", { exact: true })).toHaveValue("#123456");
    await expect(page.getByLabel("Épaisseur de bordure", { exact: true })).toHaveValue("8");
  } finally {
    await sql('DELETE FROM "VisualTemplate" WHERE name=$1', [id]);
    await sql('DELETE FROM "Author" WHERE id=$1', [id]);
  }
});
