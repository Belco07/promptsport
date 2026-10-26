import { expect, test } from "@playwright/test";
import { unlink } from "node:fs/promises";
import path from "node:path";

import { closeDb, e2eId, sql, sqlOne } from "./../fixtures/db";
import {
  clickActionButton,
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
    // Les couvertures uploadées en local ne doivent pas s'accumuler entre les
    // exécutions. Les URL Blob (production/CI) sont ignorées.
    const covers = await sql<{ coverImageUrl: string | null }>(
      `SELECT "coverImageUrl" FROM "Article"
       WHERE "authorId" = (SELECT id FROM "Author" WHERE email = $1)`,
      [TEST_EDITOR.email],
    );
    for (const cover of covers) {
      if (!cover.coverImageUrl?.startsWith("/uploads/")) continue;
      try {
        await unlink(
          path.join(
            process.cwd(),
            "public",
            cover.coverImageUrl.replace(/^\/+/, ""),
          ),
        );
      } catch {
        // Fichier déjà absent.
      }
    }

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
    // La redirection de connexion peut précéder la fin du rendu du tableau de
    // bord. Attendre son titre évite d'interrompre une navigation en cours par
    // le `page.goto` suivant (ERR_ABORTED).
    await expect(
      page.getByRole("heading", { name: /Bienvenue dans la rédaction/ }),
    ).toBeVisible({ timeout: 90_000 });

    await page.goto("/studio/articles/new");
    await expect(
      page.getByRole("heading", { name: "Nouvel article" }),
    ).toBeVisible();

    await page.getByLabel("Titre").fill(title);
    await page.locator('select[name="categoryId"]').selectOption(categoryId);
    await fillArticleContent(page, content);

    // La photo de couverture est obligatoire pour publier. On passe par le
    // vrai upload du studio, puis on attend que le champ caché soit renseigné.
    await page
      .locator('input[type="file"]')
      .setInputFiles("public/promptsport-og.png");
    await expect(
      page.locator('input[name="coverImageUrl"]'),
      "l'upload doit alimenter la couverture du formulaire",
    ).toHaveValue(/^\/uploads\/.+\.png$/, { timeout: 20_000 });
    await page
      .getByLabel("Crédit photo")
      .fill("PromptSport / visuel de test");

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

    // `load` attend les logos distants (API Sports) : le CDN peut être lent ou
    // indisponible en E2E et bloquerait la navigation bien après le rendu du
    // contenu. Le titre et le corps sont déjà dans le DOM au `domcontentloaded`.
    await page.goto(`/article/${article!.slug}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    // Ciblage du corps de l'article : le chapeau (extrait automatique) reprend
    // les premières phrases du contenu et ferait échouer un getByText global.
    await expect(page.locator(".article-body").getByText(content)).toBeVisible();
  });

  test("refuse la publication sans photo de couverture", async ({ page }) => {
    await login(page, TEST_EDITOR);
    await expect(
      page.getByRole("heading", { name: /Bienvenue dans la rédaction/ }),
    ).toBeVisible({ timeout: 90_000 });
    await page.goto("/studio/articles/new");

    await page.getByLabel("Titre").fill(`Article sans photo ${runId}`);
    await page.locator('select[name="categoryId"]').selectOption(categoryId);
    await fillArticleContent(page, content);
    await page.locator('select[name="status"]').selectOption("PUBLISHED");

    await clickActionButton(page, "Créer l'article");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Ajoutez une photo de couverture" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/studio\/articles\/new$/);

    const created = await sqlOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM "Article" WHERE title = $1`,
      [`Article sans photo ${runId}`],
    );
    expect(created?.count).toBe(0);
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
