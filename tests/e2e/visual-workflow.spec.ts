import { test, expect } from "@playwright/test";
import bcrypt from "bcryptjs";
import { sql, closeDb, e2eId } from "../fixtures/db";
import { login } from "../fixtures/helpers";
import { unlink } from "node:fs/promises";
import path from "node:path";

let id: string;
const password = "VisualWorkflow-2026!";
test.beforeEach(async () => {
  const url = new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "");
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port !== "5432") throw Error("Tests réservés à Docker local.");
  id = e2eId("visual-workflow");
  await sql('INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,\'JOURNALIST\',NOW())', [id, `${id}@example.test`, await bcrypt.hash(password, 10)]);
});
test.afterEach(async () => { if (id) await sql('DELETE FROM "Author" WHERE id=$1', [id]); });
test.afterAll(closeDb);

test("Compositeur : outils graphiques, mosaïque et stickers", async ({ page }) => {
  await login(page, { email: `${id}@example.test`, password, name: id });
  await page.goto("/studio/composer");
  await expect(page.getByRole("heading", { name: "Compositeur de fonds" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enregistrer le fond", exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByLabel("Collage / mosaïque", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Ajouter ⚽", exact: true }).click();
  await expect(page.getByRole("button", { name: "Supprimer la sélection", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Détourer l’image sélectionnée" })).toBeVisible();
});

test("Templates : accès administrateur refusé au journaliste", async ({ page }) => {
  await login(page, { email: `${id}@example.test`, password, name: id });
  await page.goto("/studio/templates");
  await expect(page).toHaveURL(/\/studio$/);
});

test("Template admin → fond composé → export journaliste", async ({ page, browser }) => {
  test.skip(process.env.E2E_VISUAL_LOCAL !== "1", "Export réservé au stockage local isolé.");
  test.setTimeout(360000);
  const previous = (await sql<{ name: string; document: unknown }>('SELECT name,document FROM "VisualTemplate" WHERE id=\'active\''))[0];
  const adminId = `${id}-admin`; const uploads: string[] = [];
  await sql('INSERT INTO "Author" (id,name,email,"passwordHash",role,"createdAt") VALUES ($1,$1,$2,$3,\'ADMIN\',NOW())', [adminId, `${adminId}@example.test`, await bcrypt.hash(password, 10)]);
  const journalistContext = await browser.newContext();
  try {
    await login(page, { email: `${adminId}@example.test`, password, name: adminId });
    await page.goto("/studio/templates");
    await expect(page.getByRole("button", { name: "Ajouter le texte", exact: true })).toBeEnabled();
    await page.getByLabel("Texte", { exact: true }).fill("Titre du template");
    await page.getByRole("button", { name: "Ajouter le texte", exact: true }).click();
    await page.getByRole("button", { name: "Utiliser la sélection comme Titre", exact: true }).click();
    await page.getByLabel("Texte", { exact: true }).fill("Sujet du template");
    await page.getByRole("button", { name: "Ajouter le texte", exact: true }).click();
    await page.getByRole("button", { name: "Utiliser la sélection comme Sujet", exact: true }).click();
    await page.getByLabel("Nom du template", { exact: true }).fill(id);
    await page.getByRole("button", { name: "Ajouter le logo PromptSport", exact: true }).click();
    await expect(page.getByRole("button", { name: "Enregistrer et activer le template", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Enregistrer et activer le template", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Template enregistré");
    const saved = (await sql<{ document: { objects: { selectable: boolean; field?: string }[] } }>('SELECT document FROM "VisualTemplate" WHERE id=\'active\''))[0];
    expect(saved.document.objects.every(object => object.selectable === false)).toBe(true);
    const journalist = await journalistContext.newPage();
    await login(journalist, { email: `${id}@example.test`, password, name: id });
    await journalist.goto("/studio/visual-studio");
    await expect(journalist.getByLabel("Titre", { exact: true })).toBeEnabled();
    await expect(journalist.getByRole("button", { name: "Ajouter le texte", exact: true })).toHaveCount(0);
    await journalist.getByLabel("Titre", { exact: true }).fill("Mon visuel final");
    const popupEvent = journalistContext.waitForEvent("page");
    await journalist.getByRole("button", { name: "Composer un fond", exact: true }).click();
    const composer = await popupEvent;
    await expect(composer.getByRole("button", { name: "Ajouter ⚽", exact: true })).toBeEnabled({ timeout: 120000 });
    await composer.getByRole("button", { name: "Ajouter ⚽", exact: true }).click();
    await composer.getByRole("button", { name: "Enregistrer le fond", exact: true }).click();
    const backgroundUrl = composer.getByLabel("URL de l’image enregistrée", { exact: true });
    await expect(backgroundUrl).toHaveValue(/^\/uploads\/.+\.png$/); uploads.push(await backgroundUrl.inputValue());
    await expect(journalist.getByRole("status")).toContainText("Fond chargé");
    await journalist.getByRole("button", { name: "Générer le visuel final", exact: true }).click();
    const finalUrl = journalist.getByLabel("URL de l’image enregistrée", { exact: true });
    await expect(finalUrl).toHaveValue(/^\/uploads\/.+\.png$/); uploads.push(await finalUrl.inputValue());
    expect((await journalist.request.get(uploads[1])).status()).toBe(200);
    await journalist.screenshot({ path: "tmp-results/visual-template-journalist.png", fullPage: true });
  } finally {
    await journalistContext.close();
    if (previous) await sql('UPDATE "VisualTemplate" SET name=$1,document=$2 WHERE id=\'active\'', [previous.name, JSON.stringify(previous.document)]);
    else await sql('DELETE FROM "VisualTemplate" WHERE id=\'active\' AND name=$1', [id]);
    await sql('DELETE FROM "Author" WHERE id=$1', [adminId]);
    for (const url of uploads) if (/^\/uploads\/[a-zA-Z0-9-]+\.png$/.test(url)) await unlink(path.join(process.cwd(), "public", url.slice(1))).catch(() => {});
  }
});
