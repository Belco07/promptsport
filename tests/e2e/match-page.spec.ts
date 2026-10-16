import { expect, test } from "@playwright/test";

import { closeDb, e2eId, sql } from "./../fixtures/db";
import { expectNoBlockingA11yViolations } from "./../fixtures/helpers";

/**
 * Parcours critique 5 — consultation d'une fiche match.
 *
 * Une rencontre terminée (2–1) est créée avec ses événements : le test la
 * retrouve dans les résultats (/scores?view=finished), ouvre sa fiche et
 * vérifie le score, les buteurs et la timeline (buts, carton, remplacement).
 *
 * Toute la donnée sportive de test est nettoyée après la suite : compétition,
 * équipes, match et événements.
 */

const runId = Date.now();
const homeName = `Paris E2E ${runId}`;
const awayName = `Lyon E2E ${runId}`;

const competitionId = e2eId("comp");
const homeTeamId = e2eId("team");
const awayTeamId = e2eId("team");
const matchId = e2eId("match");

test.describe("Fiche match (scores + timeline)", () => {
  test.beforeAll(async () => {
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
        homeTeamId,
        homeName,
        `e2e-paris-${runId}`,
        "PAR",
        awayTeamId,
        awayName,
        `e2e-lyon-${runId}`,
        "LYO",
      ],
    );
    await sql(
      `INSERT INTO "Match"
         (id, "competitionId", "homeTeamId", "awayTeamId", "homeScore", "awayScore",
          status, "scheduledAt", venue, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 2, 1, 'FINISHED', NOW() - INTERVAL '2 hours', 'Stade E2E', NOW(), NOW())`,
      [matchId, competitionId, homeTeamId, awayTeamId],
    );
    await sql(
      `INSERT INTO "MatchEvent"
         (id, "matchId", "teamId", "playerName", "assistName", type, minute, "createdAt")
       VALUES ($1, $2, $3, 'A. Etoile', NULL, 'GOAL', 12, NOW()),
              ($4, $2, $5, 'B. Comete', NULL, 'GOAL', 34, NOW()),
              ($6, $2, $3, 'C. Rocher', NULL, 'YELLOW_CARD', 55, NOW()),
              ($7, $2, $3, 'D. Banc', 'A. Etoile', 'SUBSTITUTION', 60, NOW())`,
      [
        e2eId("event"),
        matchId,
        homeTeamId,
        e2eId("event"),
        awayTeamId,
        e2eId("event"),
        e2eId("event"),
      ],
    );
  });

  test.afterAll(async () => {
    await sql(`DELETE FROM "ManOfTheMatchVote" WHERE "matchId" = $1`, [matchId]);
    await sql(`DELETE FROM "MatchEvent" WHERE "matchId" = $1`, [matchId]);
    await sql(`DELETE FROM "MatchStatistics" WHERE "matchId" = $1`, [matchId]);
    await sql(`DELETE FROM "MatchLineup" WHERE "matchId" = $1`, [matchId]);
    await sql(`DELETE FROM "Match" WHERE id = $1`, [matchId]);
    await sql(`DELETE FROM "Team" WHERE id IN ($1, $2)`, [homeTeamId, awayTeamId]);
    await sql(`DELETE FROM "Competition" WHERE id = $1`, [competitionId]);
    await closeDb();
  });

  test("le résultat apparaît dans les scores puis la fiche affiche buts et timeline", async ({
    page,
  }) => {
    // 1. Liste des résultats : la rencontre est visible avec son score.
    await page.goto("/scores?view=finished");
    const resultLink = page.getByRole("link", {
      name: new RegExp(`Fiche du match ${homeName} contre ${awayName} : 2 à 1`),
    });
    await expect(resultLink).toBeVisible();

    // 2. Ouverture de la fiche : score, équipes, enceinte.
    await resultLink.click();
    await expect(page).toHaveURL(new RegExp(`/match/${matchId}`));
    await expect(
      page.getByRole("heading", { level: 1, name: `${homeName} contre ${awayName}` }),
    ).toBeVisible();
    await expect(page.getByText("2 – 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Stade E2E")).toBeVisible();

    // 3. Timeline (onglet Résumé par défaut) : buts, carton, remplacement.
    await expect(page.getByRole("heading", { name: "Résumé" })).toBeVisible();
    await expect(page.getByText(/But · A\. Etoile/)).toBeVisible();
    await expect(page.getByText(/But · B\. Comete/)).toBeVisible();
    await expect(page.getByText(/Carton jaune · C\. Rocher/)).toBeVisible();
    await expect(page.getByText(/Remplacement · D\. Banc/)).toBeVisible();
  });

  test("la fiche match ne présente pas de violation bloquante", async ({ page }) => {
    await page.goto(`/match/${matchId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: `${homeName} contre ${awayName}` }),
    ).toBeVisible();
    await expectNoBlockingA11yViolations(page, `/match/${matchId}`);
  });
});
