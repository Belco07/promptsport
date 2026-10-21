import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { closeDb, e2eId, sql } from "../fixtures/db";
import { login } from "../fixtures/helpers";

let id: string;
let local = false;
let uploads: string[] = [];
const password = "VisualStudio-2026!pw";
test.beforeEach(async ({ page }) => {
  local = false;
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Docker local requis.");
  id = e2eId("visual-studio"); local = true; uploads = [];
  await sql(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,'EDITOR',NOW())`, [id, `${id}@example.test`, await bcrypt.hash(password, 10)]);
  await sql(`INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())`, [id]);
  await sql(`INSERT INTO "Article" (id,title,slug,content,excerpt,status,"authorId","categoryId","createdAt","updatedAt") VALUES ($1,$1,$1,'Un article avec une illustration.','Un extrait.','DRAFT',$1,$1,NOW(),NOW())`, [id]);
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  await login(page, { email: `${id}@example.test`, password, name: id });
});
test.afterEach(async () => {
  if (!local) return;
  await sql(`DELETE FROM "Article" WHERE id=$1`, [id]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [id]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [id]);
  for (const url of uploads) {
    if (/^\/uploads\/[a-zA-Z0-9-]+\.(png|webp)$/.test(url)) await unlink(path.join(process.cwd(), "public", url.slice(1))).catch(() => {});
  }
});
test.afterAll(closeDb);

test("Visual Studio : texte, formes et export PNG aux dimensions natives", async ({ page }) => {
  await page.goto("/studio/visual-studio");
  await expect(page.getByRole("heading", { name: "Visual Studio", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext("2d")!; context.fillStyle = "#0066cc"; context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Importer un fond", { exact: true }).setInputFiles({ name: "fond.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await expect(page.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
  await page.getByLabel("Filtre du fond", { exact: true }).selectOption("gray");
  await page.getByLabel("Texte", { exact: true }).fill("PROMPTSPORT — LE MATCH");
  await page.getByRole("button", { name: "Ajouter le texte", exact: true }).click();
  await page.getByLabel("Couleur du texte ou de la forme", { exact: true }).fill("#0055aa");
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByRole("button", { name: "Reculer", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger", exact: true }).click();
  const file = await (await download).path();
  const bytes = await readFile(file!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
  await page.screenshot({ path: "tmp-results/wp46-visual-studio.png", fullPage: true });
});

test("Visual Studio : sauvegarde et retour automatique dans le texte de l’article", async ({ page, context }) => {
  test.skip(process.env.E2E_VISUAL_LOCAL !== "1", "Utiliser npm run test:visual-studio pour un upload local isolé.");
  await page.goto(`/studio/articles/${id}/edit`);
  const popupEvent = context.waitForEvent("page");
  await page.getByRole("button", { name: "Créer une image avec le Visual Studio", exact: true }).click();
  const popup = await popupEvent;
  try {
    await expect(popup.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
    await popup.getByLabel("Texte", { exact: true }).fill("Une image originale");
    await popup.getByRole("button", { name: "Ajouter le texte", exact: true }).click();
    await popup.getByRole("button", { name: "Enregistrer", exact: true }).click();
    const urlInput = popup.getByLabel("URL de l’image enregistrée", { exact: true });
    await expect(urlInput).toHaveValue(/^\/uploads\/.+\.png$/);
    const url = await urlInput.inputValue(); uploads.push(url);
    await expect(page.locator('input[name="content"]')).toHaveValue(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect((await page.request.get(url)).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/studio/articles/${id}/edit`));
  } finally { await popup.close(); }
});

test("Visual Studio : retour en couverture, brouillon non perdu et messages étrangers ignorés", async ({ page, context }) => {
  test.skip(process.env.E2E_VISUAL_LOCAL !== "1", "Utiliser npm run test:visual-studio pour un upload local isolé.");
  await page.goto(`/studio/articles/${id}/edit`);
  await page.getByLabel("Titre", { exact: true }).fill("Titre non encore enregistré");
  const popupEvent = context.waitForEvent("page");
  await page.getByRole("button", { name: "Créer une image de couverture avec le Visual Studio", exact: true }).click();
  const popup = await popupEvent;
  try {
    await expect(popup.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
    await page.evaluate(() => window.postMessage({ type: "visual-studio:saved", channel: "wrong", url: "/uploads/foreign.png" }, window.location.origin));
    await expect(page.locator('input[name="coverImageUrl"]')).not.toHaveValue("/uploads/foreign.png");
    await popup.getByRole("button", { name: "Ajouter le texte", exact: true }).click();
    await popup.getByLabel("Format d’export", { exact: true }).selectOption("image/webp");
    await popup.getByRole("button", { name: "Enregistrer", exact: true }).click();
    const urlInput = popup.getByLabel("URL de l’image enregistrée", { exact: true });
    await expect(urlInput).toHaveValue(/^\/uploads\/.+\.webp$/);
    const url = await urlInput.inputValue(); uploads.push(url);
    await expect(page.locator('input[name="coverImageUrl"]')).toHaveValue(url);
    await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Titre non encore enregistré");
  } finally { await popup.close(); }
});
