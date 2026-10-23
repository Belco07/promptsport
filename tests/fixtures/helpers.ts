import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

import type { TestUser } from "./users";

/**
 * Helpers partagés par les tests E2E (E2E-1).
 */

/**
 * Clique un bouton de Server Action jusqu'à ce que la requête parte vraiment.
 *
 * Les formulaires à Server Action sont rendus côté serveur : tant que React n'a
 * pas fini de s'hydrater, un clic part en **soumission native** et Next répond
 * 500 sans exécuter l'action (vérifié : sans en-tête `Next-Action`, la requête
 * n'est pas traitée comme une action). Sur un serveur de développement chargé,
 * ce clic perdu faisait échouer le test sans rien créer.
 *
 * La requête d'action porte l'en-tête `Next-Action` : on ne relance donc le
 * clic que si aucune requête de ce type n'est observée — jamais deux fois la
 * même action, ce qui serait inacceptable pour une action non idempotente
 * (création d'article).
 */
async function clickUntilActionPosts(
  page: Page,
  button: Locator,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const posted = page
      .waitForRequest(
        (request) =>
          request.method() === "POST" &&
          Boolean(request.headers()["next-action"]),
        { timeout: Math.max(1_000, Math.min(10_000, deadline - Date.now())) },
      )
      .then(() => true)
      .catch(() => false);

    await button.click();
    if (await posted) return;

    if (Date.now() >= deadline) {
      throw new Error(
        "Le clic n'a déclenché aucune Server Action (bouton cliqué avant l'hydratation ?).",
      );
    }
  }
}

/**
 * Soumet un formulaire de Server Action sans navigation attendue (ex. :
 * inscription à la newsletter) et rend la main une fois l'action déclenchée.
 */
export async function clickActionButton(
  page: Page,
  buttonName: string,
  timeoutMs = 60_000,
): Promise<void> {
  await clickUntilActionPosts(
    page,
    page.getByRole("button", { name: buttonName, exact: true }),
    timeoutMs,
  );
}

/**
 * Soumet un formulaire de Server Action puis attend la navigation annoncée.
 */
export async function submitActionForm(
  page: Page,
  buttonName: string,
  destination: RegExp,
  navigationTimeoutMs = 90_000,
): Promise<void> {
  await clickUntilActionPosts(
    page,
    page.getByRole("button", { name: buttonName }),
    60_000,
  );
  await expect(page).toHaveURL(destination, { timeout: navigationTimeoutMs });
}

/**
 * Connexion par identifiants depuis /login.
 *
 * La Server Action redirige selon le rôle (lecteur → /mon-compte, éditeur →
 * /studio) : l'appelant vérifie la destination attendue avec `toHaveURL`.
 */
export async function login(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(user.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(user.password);
  await clickUntilActionPosts(
    page,
    page.getByRole("button", { name: "Se connecter" }),
    60_000,
  );
  // Sans attendre la sortie de /login, le `page.goto` suivant partirait avant
  // que la session soit posée et le test verrait un visiteur anonyme.
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 90_000,
  });
}

/**
 * Saisit le contenu d'un article dans l'éditeur riche du studio.
 *
 * MDXEditor est monté côté client (`ssr: false`) : on attend le champ éditable,
 * on y saisit le texte, puis on contrôle que le champ caché `content` — celui
 * que la Server Action lit — a bien reçu la valeur avant la soumission.
 */
export async function fillArticleContent(page: Page, text: string): Promise<void> {
  const editor = page.locator(".rich-text-editor-content").first();
  await editor.waitFor({ state: "visible" });
  await editor.click();
  await editor.pressSequentially(text, { delay: 5 });
  await expect(
    page.locator('input[name="content"]'),
    "le contenu saisi doit alimenter le champ caché du formulaire",
  ).toHaveValue(/[a-zA-Z]{3,}/, { timeout: 15_000 });
}

/**
 * Vérifie l'accessibilité de la page courante avec axe-core.
 *
 * La gate bloque sur « critical » et « serious » (WP30) : ce sont les niveaux
 * qui empêchent réellement l'accès ou la compréhension (contrôles inaccessibles,
 * libellés absents, contrastes illisibles…). Les niveaux « moderate » et
 * « minor » restent journalisés sans bloquer — l'interface a des chantiers
 * d'accessibilité connus hors des parcours critiques, et une suite rouge en
 * permanence ne protégerait plus rien.
 *
 * WP27 : l'analyse se fait avec `prefers-reduced-motion: reduce`, que
 * `motion.css` neutralise. Sans cela, axe peut tomber pendant une animation
 * d'entrée (`fade-up`, `slide-in-right`) : un texte `--muted-foreground`
 * (#636363) composé à 75 % d'opacité sur fond blanc est mesuré #8a8a8a →
 * 3,45:1 et la porte échoue sur un état transitoire (arrivé en CI, où le
 * serveur de développement injecte le CSS au fil de l'hydratation). Un texte
 * ne se lit pas « à mi-opacité » : c'est l'état stabilisé qui fait foi, et
 * c'est aussi la recommandation d'axe-core (pas de mesure fiable pendant une
 * animation).
 */
export async function expectNoBlockingA11yViolations(
  page: Page,
  context: string,
): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  try {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    );
    for (const violation of results.violations.filter(
      (v) => v.impact !== "critical" && v.impact !== "serious",
    )) {
      console.warn(
        `[a11y] ${context} — ${violation.impact} : ${violation.id} (${violation.nodes.length} élément(s))`,
      );
    }
    const detail = blocking
      .map(
        (violation) =>
          `- [${violation.impact}] ${violation.id} : ${violation.help} (${violation.nodes.length} élément(s))`,
      )
      .join("\n");
    expect(
      blocking,
      `Violations d'accessibilité critiques sur « ${context} » :\n${detail}`,
    ).toEqual([]);
  } finally {
    // Rend la main au test avec les préférences système, l'émulation ne devant
    // pas fuiter sur les assertions suivantes de la page.
    await page.emulateMedia({ reducedMotion: null });
  }
}
