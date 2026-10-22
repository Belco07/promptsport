import { stubBrowserBlob } from "../fixtures/visual-blob-browser";
import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { closeDb, e2eId, sql } from "../fixtures/db";
import { login } from "../fixtures/helpers";

// MDXEditor and the canvas compile separately on the first local dev visit.
test.setTimeout(360_000);

let id: string;
let local = false;
let uploads: string[] = [];
let previousTemplate: { name: string; document: unknown } | undefined;
const password = "VisualStudio-2026!pw";
test.beforeEach(async ({ page }) => {
  await stubBrowserBlob(page.context());
  local = false;
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Docker local requis.");
  id = e2eId("visual-studio"); local = true; uploads = [];
  previousTemplate = (await sql('SELECT name,document FROM "VisualTemplate" WHERE id=\'active\''))[0] as typeof previousTemplate;
  const template = { width: 1200, height: 630, objects: [{ type: "Textbox", text: "Titre", field: "title", left: 50, top: 50, width: 1000, fontSize: 60, fill: "#ffffff" }, { type: "Textbox", text: "Sujet", field: "subject", left: 50, top: 150, width: 1000, fontSize: 30, fill: "#ffffff" }] };
  await sql('INSERT INTO "VisualTemplate" (id,name,document,"updatedAt") VALUES (\'active\',$1,$2,NOW()) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,document=EXCLUDED.document', [id, JSON.stringify(template)]);
  await sql(`INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,'EDITOR',NOW())`, [id, `${id}@example.test`, await bcrypt.hash(password, 10)]);
  await sql(`INSERT INTO "Category" (id,name,slug,"createdAt") VALUES ($1,$1,$1,NOW())`, [id]);
  await sql(`INSERT INTO "Article" (id,title,slug,content,excerpt,status,"authorId","categoryId","createdAt","updatedAt") VALUES ($1,$1,$1,'Un article avec une illustration.','Un extrait.','DRAFT',$1,$1,NOW(),NOW())`, [id]);
  await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  await login(page, { email: `${id}@example.test`, password, name: id });
});
test.afterEach(async () => {
  if (!local) return;
  if (previousTemplate) await sql('UPDATE "VisualTemplate" SET name=$1,document=$2 WHERE id=\'active\'', [previousTemplate.name, JSON.stringify(previousTemplate.document)]);
  else await sql('DELETE FROM "VisualTemplate" WHERE id=\'active\' AND name=$1', [id]);
  await sql(`DELETE FROM "Article" WHERE id=$1`, [id]);
  await sql(`DELETE FROM "Category" WHERE id=$1`, [id]);
  await sql(`DELETE FROM "Author" WHERE id=$1`, [id]);
  for (const url of uploads) {
    if (/^\/uploads\/[a-zA-Z0-9-]+\.(png|webp)$/.test(url)) await unlink(path.join(process.cwd(), "public", url.slice(1))).catch(() => {});
  }
});
test.afterAll(closeDb);

test("rédaction : couverture de 5 Mo envoyée directement vers Blob", async ({ page }) => {
  test.skip(process.env.E2E_VISUAL_BLOB_STUB !== "1", "Stockage externe simulé requis.");
  await page.goto(`/studio/articles/${id}/edit`);
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8l8AAAAASUVORK5CYII=", "base64");
  const image = Buffer.alloc(5 * 1024 * 1024);
  pixel.copy(image);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choisir une image", exact: true }).click();
  await (await chooser).setFiles({ name: "couverture.png", mimeType: "image/png", buffer: image });
  const cover = page.locator('input[name="coverImageUrl"]');
  await expect(cover).toHaveValue(/^\/uploads\/.+\.png$/);
  const url = await cover.inputValue(); uploads.push(url);
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  expect((await response.body()).length).toBe(5 * 1024 * 1024);
});

test("Visual Studio : texte, formes et export PNG aux dimensions natives", async ({ page }) => {
  await page.goto("/studio/composer");
  await expect(page.getByRole("heading", { name: "Compositeur de fonds", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext("2d")!; context.fillStyle = "#0066cc"; context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Importer un fond", { exact: true }).setInputFiles({ name: "fond.png", mimeType: "image/png", buffer: Buffer.from(photo, "base64") });
  await expect(page.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
  await page.getByLabel("Filtre du fond", { exact: true }).selectOption("gray");
  await page.getByRole("button", { name: "Régler le fond", exact: true }).click();
  const brightness = page.getByLabel("Luminosité", { exact: true });
  await expect(brightness).toBeEnabled();
  await brightness.press("ArrowLeft");
  await expect(brightness).toHaveValue("-0.05");
  await page.getByLabel("Effet de détachement", { exact: true }).selectOption("shadow");
  await page.getByLabel("Texte", { exact: true }).fill("PROMPTSPORT — LE MATCH");
  await page.getByRole("button", { name: "Ajouter le texte", exact: true }).click();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.getByLabel("Couleur du texte ou de la forme", { exact: true }).fill("#0055aa");
  await page.getByRole("button", { name: "Reculer", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger", exact: true }).click();
  const file = await (await download).path();
  const bytes = await readFile(file!);
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.readUInt32BE(16)).toBe(1200);
  expect(bytes.readUInt32BE(20)).toBe(630);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "tmp-results/wp46-visual-studio.png", fullPage: true });
});

test("Visual Studio : sauvegarde et retour automatique dans le texte de l’article", async ({ page, context }) => {
  test.skip(process.env.E2E_VISUAL_LOCAL !== "1", "Utiliser npm run test:visual-studio pour un upload local isolé.");
  await page.goto(`/studio/articles/${id}/edit`, { waitUntil: "domcontentloaded" });
  const popupEvent = context.waitForEvent("page");
  await page.getByRole("button", { name: "Créer une image avec le Visual Studio", exact: true }).click();
  const popup = await popupEvent;
  try {
    await expect(popup.getByRole("button", { name: "Générer le visuel final", exact: true })).toBeEnabled();
    await popup.getByLabel("Titre", { exact: true }).fill("Une image originale");
    await popup.getByRole("button", { name: "Générer le visuel final", exact: true }).click();
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
  await page.goto(`/studio/articles/${id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Créer une image de couverture avec le Visual Studio", exact: true })).toBeEnabled();
  await page.getByLabel("Titre", { exact: true }).fill("Titre non encore enregistré");
  const popupEvent = context.waitForEvent("page");
  await page.getByRole("button", { name: "Créer une image de couverture avec le Visual Studio", exact: true }).click();
  const popup = await popupEvent;
  try {
    await expect(popup.getByRole("button", { name: "Générer le visuel final", exact: true })).toBeEnabled();
    await page.evaluate(() => window.postMessage({ type: "visual-studio:saved", channel: "wrong", url: "/uploads/foreign.png" }, window.location.origin));
    await expect(page.locator('input[name="coverImageUrl"]')).not.toHaveValue("/uploads/foreign.png");
    await popup.getByRole("button", { name: "Générer le visuel final", exact: true }).click();
    const urlInput = popup.getByLabel("URL de l’image enregistrée", { exact: true });
    await expect(urlInput).toHaveValue(/^\/uploads\/.+\.png$/);
    const url = await urlInput.inputValue(); uploads.push(url);
    await expect(page.locator('input[name="coverImageUrl"]')).toHaveValue(url);
    await expect(page.getByLabel("Titre", { exact: true })).toHaveValue("Titre non encore enregistré");
  } finally { await popup.close(); }
});

