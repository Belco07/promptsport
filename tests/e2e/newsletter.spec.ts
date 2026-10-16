import { expect, test } from "@playwright/test";

import { closeDb, e2eEmail, sql, sqlOne } from "./../fixtures/db";
import {
  clickActionButton,
  expectNoBlockingA11yViolations,
} from "./../fixtures/helpers";

/**
 * Parcours critique 4 — inscription à la newsletter.
 *
 * Visiteur anonyme → /newsletter → adresse + consentement → double opt-in :
 * le message de confirmation s'affiche et l'abonné est créé en base avec le
 * statut PENDING (la confirmation par e-mail n'est pas jouée : Resend peut être
 * absent de l'environnement de test, l'action le signale sans échouer).
 *
 * L'abonné de test est supprimé après la suite.
 */

test.describe("Inscription newsletter", () => {
  test.afterAll(async () => {
    await sql(`DELETE FROM "NewsletterSubscriber" WHERE email LIKE 'e2e-news-%@example.test'`);
    await closeDb();
  });

  test("un visiteur s'inscrit avec consentement et reste en attente de confirmation", async ({
    page,
  }) => {
    const email = e2eEmail("news");

    await page.goto("/newsletter");
    await expect(
      page.getByRole("heading", { name: /Recevez l'essentiel de l'actualité sportive/ }),
    ).toBeVisible();

    await page.locator("#email").fill(email);
    await page.locator("#consentement").check();
    await clickActionButton(page, "S'inscrire");

    await expect(
      page.getByText(/Vérifiez votre boîte mail pour confirmer votre inscription/),
    ).toBeVisible();

    // Double opt-in : l'abonné existe, mais tant qu'il n'a pas confirmé par
    // e-mail, son statut reste PENDING.
    const subscriber = await sqlOne<{ status: string }>(
      `SELECT status FROM "NewsletterSubscriber" WHERE email = $1`,
      [email],
    );
    expect(subscriber?.status, "l'abonné doit attendre sa confirmation").toBe("PENDING");
  });

  test("la page newsletter ne présente pas de violation bloquante", async ({
    page,
  }) => {
    await page.goto("/newsletter");
    await expectNoBlockingA11yViolations(page, "/newsletter");
  });
});
