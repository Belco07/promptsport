import { expect, test } from "@playwright/test";

import { closeDb, e2eId, sql, sqlOne } from "./../fixtures/db";
import {
  expectNoBlockingA11yViolations,
  login,
  submitActionForm,
} from "./../fixtures/helpers";
import { TEST_EDITOR, TEST_READER } from "./../fixtures/users";

/**
 * Parcours critique 3 — commentaire sur un article.
 *
 * Un lecteur connecté commente un article publié. Les commentaires passent par
 * la modération (statut PENDING) : le test vérifie le message de confirmation
 * « envoyé, en attente de validation » côté interface, puis l'existence réelle
 * du commentaire en base — c'est la « vérification » attendue, la publication
 * publique dépendant d'un modérateur.
 *
 * L'article de test est créé par un éditeur de test puis supprimé après la
 * suite, avec ses commentaires (cascade).
 */

const runId = Date.now();
const articleTitle = `Article commentaires E2E ${runId}`;
const slug = `e2e-commentaires-${runId}`;
const commentText = `Commentaire E2E ${runId} — analyse de test.`;

let categoryId: string;
let articleId: string;

test.describe("Commentaire sur un article", () => {
  test.beforeAll(async () => {
    categoryId = e2eId("cat");
    articleId = e2eId("article");
    await sql(
      `INSERT INTO "Category" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [categoryId, `Catégorie commentaires ${runId}`, categoryId],
    );
    await sql(
      `INSERT INTO "Article"
         (id, title, slug, content, status, "publishedAt", "authorId", "categoryId",
          format, "isPremium", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PUBLISHED', NOW(),
               (SELECT id FROM "Author" WHERE email = $5), $6,
               'NEWS', false, NOW(), NOW())`,
      [
        articleId,
        articleTitle,
        slug,
        `${articleTitle} : contenu de test suffisant pour la page publique.`,
        TEST_EDITOR.email,
        categoryId,
      ],
    );
  });

  test.afterAll(async () => {
    await sql(`DELETE FROM "Comment" WHERE "articleId" = $1`, [articleId]);
    await sql(`DELETE FROM "Article" WHERE id = $1`, [articleId]);
    await sql(`DELETE FROM "Category" WHERE id = $1`, [categoryId]);
    await closeDb();
  });

  test("le lecteur commente et retrouve son message en attente de modération", async ({
    page,
  }) => {
    await login(page, TEST_READER);
    await page.goto(`/article/${slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: articleTitle }),
    ).toBeVisible();
    await expect(page.getByText("Votre commentaire")).toBeVisible();

    await page.locator("#champ-commentaire").fill(commentText);
    await submitActionForm(page, "Publier", /commentaire=en-attente/);

    // Message de succès : le commentaire attend la modération.
    await expect(
      page.getByText("Votre commentaire a été envoyé. Il sera publié après validation par la modération."),
    ).toBeVisible();

    // Vérification en base : le commentaire existe bien, en attente de modération.
    const comment = await sqlOne<{ status: string; content: string }>(
      `SELECT status, content FROM "Comment" WHERE "articleId" = $1`,
      [articleId],
    );
    expect(comment?.status, "le commentaire doit attendre la modération").toBe("PENDING");
    expect(comment?.content).toContain(commentText);
  });

  test("la page article ne présente pas de violation bloquante", async ({
    page,
  }) => {
    await page.goto(`/article/${slug}`);
    await expectNoBlockingA11yViolations(page, `article /article/${slug}`);
  });
});
