import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright — parcours critiques E2E-1.
 *
 * Les tests visent un serveur Next.js de développement sur le port 3002
 * (celui du README : le port 3000 est réservé à un autre projet sur le poste).
 * Le serveur est démarré automatiquement, sauf s'il tourne déjà : en local, un
 * `npm run dev` ouvert dans un terminal est réutilisé, ce qui évite un
 * démarrage à froid à chaque campagne.
 *
 * Variables d'environnement reconnues :
 *   - PLAYWRIGHT_BASE_URL : URL de base (défaut http://localhost:3002) ;
 *   - CI : active un retry par test et interdit la réutilisation du serveur.
 */

const baseURL = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002");
const port = baseURL.port || "3002";

export default defineConfig({
  testDir: "./tests/e2e",

  /**
   * Préchauffe le serveur de développement (compilation des routes lentes dont
   * celles que les Server Actions revalident) avant le premier test.
   */
  globalSetup: "./tests/setup/warmup.ts",

  /**
   * Un seul worker : les scénarios partagent la même base PostgreSQL et le même
   * serveur de développement (compilation à la demande). La parité l'emporte sur
   * la vitesse pour une suite de cette taille.
   */
  workers: 1,
  fullyParallel: false,

  /** En CI, un test peut être relancé une fois (covariance réseau/compilation). */
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  /**
   * Délai généreux : en local comme en CI, le serveur est `next dev`, qui
   * compile chaque route à la première visite (20–30 s sur un poste chargé).
   * Un budget de 60 s faisait échouer les tests sur cette latence de
   * compilation, pas sur une régression.
   */
  timeout: 180_000,
  expect: { timeout: 30_000 },

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",

  use: {
    baseURL: baseURL.origin,
    headless: true,
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    /**
     * IP fictive propre à chaque campagne : les limitations de débit des
     * Server Actions (inscription, newsletter) sont comptées par IP côté
     * serveur. Une valeur unique par exécution rend les tests rejouables
     * immédiatement, même sur un serveur de développement réutilisé.
     */
    extraHTTPHeaders: { "x-forwarded-for": `e2e-${Date.now()}` },
  },

  projects: [
    {
      name: "chromium",
      // Un seul navigateur : suffisant pour sécuriser les parcours, plus rapide.
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL.origin,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
