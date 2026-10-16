import { expect, test } from "@playwright/test";

import { closeDb, e2eId, sql, sqlOne } from "./../fixtures/db";
import {
  expectNoBlockingA11yViolations,
  fillArticleContent,
  login,
  submitActionForm,
} from "./../fixtures/helpers";
import { TEST_EDITOR } from "./../fixtures/users";

/**
 * Parcours critique 2 — publication d'un article depuis le studio.
 *
 * Éditeur connecté → /studio/articles/new → titre, catégorie, contenu, statut
 * « Publié » → l'article apparaît dans la liste du studio et sur la page
 * publique /article/[slug].
 *
 * Une catégorie de test est créée avant la suite et supprimée après, avec les
 * articles de l'éditeur de test : la base de développement reste inchangée.
 */

const runId = Date.now();
const title = `Article E2E ${runId}`;
const content = `Contenu E2E ${runId} : la rédaction valide la publication.`;

let categoryId: string;

test.describe("Publication d'un article (studio)", () => {
  test.beforeAll(async () => {
    categoryId = e2eId("cat");
    await sql(
      `INSERT INTO "Category" (id, name, slug, "createdAt")
       VALUES ($1, $2, $3, NOW())`,
      [categoryId, `Catégorie ${runId}`, categoryId],
    );
  });

  test.afterAll(async () => {
    // Les articles de l'éditeur de test sont supprimés avant leur catégorie
    // (clé étrangère obligatoire côté Article).
    await sql(
      `DELETE FROM "Article" WHERE "authorId" = (SELECT id FROM "Author" WHERE email = $1)`,
      [TEST_EDITOR.email],
    );
    await sql(`DELETE FROM "Category" WHERE id = $1`, [categoryId]);
    await closeDb();
  });

  test("l'éditeur crée puis publie un article visible publiquement", async ({
    page,
  }) => {
    await login(page, TEST_EDITOR);
    await expect(page).toHaveURL(/\/studio/);

    await page.goto("/studio/articles/new");
    await expect(
      page.getByRole("heading", { name: "Nouvel article" }),
    ).toBeVisible();

    await page.getByLabel("Titre").fill(title);
    await page.locator('select[name="categoryId"]').selectOption(categoryId);
    await fillArticleContent(page, content);
    await page.locator('select[name="status"]').selectOption("PUBLISHED");

    // Retour à la liste du studio : l'article publié y figure. L'ancrage `$`
    // évite de confondre la liste avec le formulaire `/studio/articles/new`.
    await submitActionForm(page, "Créer l'article", /\/studio\/articles$/);
    await expect(page.getByText(title)).toBeVisible();

    // La lecture publique confirme la publication, pas seulement l'écriture.
    const article = await sqlOne<{ slug: string }>(
      `SELECT slug FROM "Article" WHERE title = $1`,
      [title],
    );
    expect(article?.slug, "l'article créé doit exister en base").toBeTruthy();

    await page.goto(`/article/${article!.slug}`);
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    // Ciblage du corps de l'article : le chapeau (extrait automatique) reprend
    // les premières phrases du contenu et ferait échouer un getByText global.
    await expect(page.locator(".article-body").getByText(content)).toBeVisible();
  });

  test("le formulaire de création ne présente pas de violation bloquante", async ({
    page,
  }) => {
    await login(page, TEST_EDITOR);
    await page.goto("/studio/articles/new");
    // Laisse l'éditeur riche (monté côté client) s'installer avant l'analyse.
    await page.locator(".rich-text-editor-content").first().waitFor({ state: "visible" });
    await expectNoBlockingA11yViolations(page, "/studio/articles/new");
  });
});
