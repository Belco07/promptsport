import { expect, test } from "@playwright/test";

import { closeDb, e2eId, sql } from "../fixtures/db";
import {
  clickActionButton,
  expectNoBlockingA11yViolations,
  login,
} from "../fixtures/helpers";
import { TEST_EDITOR } from "../fixtures/users";

/**
 * Parcours critique WP38 — commentaire éditorial en direct (Studio Live).
 *
 * Un journaliste publie une intervention depuis /studio/live/[matchId] ; elle
 * doit apparaître immédiatement sur la fiche match publique, fusionnée avec
 * les événements automatiques de la timeline (onglet Résumé).
 *
 * Un compte éditeur isolé est créé à la volée pour que ce parcours
 * reste indépendant du script `seed-test-users.cjs` ; seuls les objets créés
 * pour ce test sont supprimés en fin de suite.
 */

const bcrypt = require("bcryptjs"); // eslint-disable-line @typescript-eslint/no-require-imports

const runId = Date.now();
const homeName = `Nice E2E ${runId}`;
const awayName = `Monaco E2E ${runId}`;

const authorId = e2eId("author");
const editor = { ...TEST_EDITOR, email: `${authorId}@example.test` };
const competitionId = e2eId("comp");
const homeTeamId = e2eId("team");
const awayTeamId = e2eId("team");
const matchId = e2eId("match");

const editorialContent = `Analyse tactique E2E ${runId} : bloc bas et transitions rapides.`;

test.describe("Commentaire éditorial en direct (Studio Live)", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/analytics/track", route => route.fulfill({ status: 204 }));
  });
  test.beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_EDITOR.password, 10);
    await sql(
      `INSERT INTO "Author" (id, name, email, "passwordHash", role, "createdAt")
       VALUES ($1, $2, $3, $4, 'EDITOR', NOW())
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, "passwordHash" = EXCLUDED."passwordHash", role = EXCLUDED.role`,
      [authorId, editor.name, editor.email, passwordHash],
    );
    await sql(
      `INSERT INTO "Competition" (id, name, slug, country, sport, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'France', 'football', NOW(), NOW())`,
      [competitionId, `Compétition E2E ${runId}`, `e2e-competition-${runId}`],
    );
    await sql(
      `INSERT INTO "Team" (id, name, slug, "shortName", sport, country, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'football', 'France', NOW(), NOW()),
              ($5, $6, $7, $8, 'football', 'France', NOW(), NOW())`,
      [
        homeTeamId, homeName, `e2e-nice-${runId}`, "NIC",
        awayTeamId, awayName, `e2e-monaco-${runId}`, "MCO",
      ],
    );
    await sql(
      `INSERT INTO "Match"
         (id, "competitionId", "homeTeamId", "awayTeamId", "homeScore", "awayScore",
          status, "scheduledAt", venue, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 0, 0, 'LIVE', NOW(), 'Stade E2E', NOW(), NOW())`,
      [matchId, competitionId, homeTeamId, awayTeamId],
    );
    await sql(
      `INSERT INTO "MatchEvent" (id, "matchId", "teamId", "playerName", type, minute, "createdAt")
       VALUES ($1, $2, $3, 'A. Etoile', 'GOAL', 12, NOW())`,
      [e2eId("event"), matchId, homeTeamId],
    );
  });

  test.afterAll(async () => {
    await sql(`DELETE FROM "MatchLiveUpdate" WHERE "matchId" = $1`, [matchId]);
    await sql(`DELETE FROM "MatchEvent" WHERE "matchId" = $1`, [matchId]);
    await sql(`DELETE FROM "Match" WHERE id = $1`, [matchId]);
    await sql(`DELETE FROM "Team" WHERE id IN ($1, $2)`, [homeTeamId, awayTeamId]);
    await sql(`DELETE FROM "Competition" WHERE id = $1`, [competitionId]);
    await sql(`DELETE FROM "Author" WHERE id = $1`, [authorId]);
    await closeDb();
  });

  test("le journaliste publie une intervention qui apparaît sur le studio et la fiche match", async ({
    page,
  }) => {
    await login(page, editor);

    // Le lien « Studio Live » est proposé depuis le tableau de rédaction.
    await page.goto("/studio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Studio Live" })).toBeVisible();

    // 1. Studio Live : formulaire, bandeau « Match en direct », liste des interventions.
    await page.goto(`/studio/live/${matchId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Studio Live/ })).toBeVisible();
    await expect(page.getByText(/Match en direct/)).toBeVisible();
    await expect(page.getByLabel("Commentaire en direct")).toBeVisible();
    await expect(page.getByLabel(/Type d.?événement/)).toHaveValue("TEXT");

    await page.getByLabel("Commentaire en direct").fill(editorialContent);
    await page.getByLabel("Minute").fill("23");
    await page.getByLabel(/Type d.?événement/).selectOption("TEXT");

    await clickActionButton(page, "Publier");
    await expect(
      page.getByRole("status").filter({ hasText: /Intervention publiée en direct/ }),
    ).toBeVisible();
    await expect(page.getByText(editorialContent, { exact: true })).toBeVisible();
    await expect(page.getByText("23′")).toBeVisible();
    await expect(page.getByText("Par Éditeur E2E")).toBeVisible();

    // 2. Fiche match publique : l'intervention apparaît dans le Résumé,
    //    fusionnée avec l'événement automatique (but à la 12ᵉ).
    await page.goto(`/match/${matchId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^(?:Le )?Résumé$/ })).toBeVisible();
    await expect(page.getByText(/But · A\. Etoile/)).toBeVisible();
    await expect(page.getByText(editorialContent)).toBeVisible();
    await expect(page.getByText(/23′/)).toBeVisible();
    await expect(page.getByText("Par Éditeur E2E")).toBeVisible();
    await expect(page.getByText("Éditorial")).toBeVisible();

    // L'intervention épinglée remonte tout en haut de la timeline.
    await sql(
      `UPDATE "MatchLiveUpdate" SET "isPinned" = true WHERE "matchId" = $1`,
      [matchId],
    );
    await page.goto(`/match/${matchId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main").getByText("Épinglé", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(editorialContent, { exact: true }),
    ).toBeVisible();
  });

  test("la fiche match et le studio ne présentent pas de violation bloquante", async ({
    page,
  }) => {
    await page.goto(`/match/${matchId}`, { waitUntil: "domcontentloaded" });
    await expectNoBlockingA11yViolations(page, `/match/${matchId}`);
    await login(page, editor);
    await page.goto(`/studio/live/${matchId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: /Studio Live/ })).toBeVisible();
    await expectNoBlockingA11yViolations(page, `/studio/live/${matchId}`);
  });
});
