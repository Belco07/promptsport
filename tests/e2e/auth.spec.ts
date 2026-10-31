import { expect, test } from "@playwright/test";

import { closeDb, e2eEmail, sql } from "../fixtures/db";
import {
  expectNoBlockingA11yViolations,
  login,
  submitActionForm,
} from "../fixtures/helpers";
import { TEST_READER } from "../fixtures/users";

/**
 * Parcours critique 1 — inscription et connexion lecteur.
 *
 * Inscription : formulaire public /inscription → création du compte → étape de
 * bienvenue → espace personnel /mon-compte.
 * Connexion : compte lecteur seedé → /mon-compte.
 * Accessibilité : axe-core sur /login et /inscription.
 *
 * Les comptes créés par le test sont supprimés à la fin de chaque test (adresse
 * unique `e2e-…@example.test`), pour que la campagne soit rejouable.
 */

test.describe("Inscription et connexion lecteur", () => {
  test.afterAll(async () => {
    await closeDb();
  });

  test("un visiteur crée son compte puis termine le parcours de bienvenue", async ({
    page,
  }) => {
    const email = e2eEmail("reader");
    const password = "Motdepasse-E2E-2026!";

    try {
      await page.goto("/inscription", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { name: "Créer un compte" }),
      ).toBeVisible();

      await page.getByLabel("PRÉNOM").fill("Lecteur Test E2E");
      await page.getByLabel("ADRESSE E-MAIL").fill(email);
      await page.getByLabel("MOT DE PASSE").fill(password);
      await page.locator('input[name="terms"]').check();

      // Le compte vient d'être créé et connecté : première étape, /bienvenue.
      await submitActionForm(
        page,
        "Créer un compte et continuer",
        /\/bienvenue/,
      );
      await expect(
        page.getByRole("heading", { name: "Bienvenue sur PromptSport" }),
      ).toBeVisible();

      await submitActionForm(page, "Peut-être plus tard", /\/mon-compte/);
      await expect(
        page.getByRole("heading", { name: "Mon compte" }),
      ).toBeVisible();
      await expect(page.getByText(email)).toBeVisible();
    } finally {
      // Nettoyage du compte créé : la suppression en cascade emporte ses
      // éventuels commentaires et réactions.
      await sql(`DELETE FROM "Author" WHERE email = $1`, [email]);
    }
  });

  test("un lecteur existant se connecte et accède à son espace", async ({
    page,
  }) => {
    await login(page, TEST_READER);

    await expect(page).toHaveURL(/\/mon-compte/);
    await expect(page.getByRole("heading", { name: "Mon compte" })).toBeVisible();
    await expect(page.getByText(TEST_READER.email)).toBeVisible();
  });

  test("les pages d'authentification ne présentent pas de violation bloquante", async ({
    page,
  }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expectNoBlockingA11yViolations(page, "/login");

    await page.goto("/inscription", { waitUntil: "domcontentloaded" });
    await expectNoBlockingA11yViolations(page, "/inscription");
  });
});
