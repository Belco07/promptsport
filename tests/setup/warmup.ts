import { request } from "@playwright/test";

/**
 * Préchauffage du serveur de développement (E2E-1).
 *
 * `next dev` compile chaque route à la première visite. Prendre cette latence
 * pendant les tests rendait certaines campagnes instables : créer un article
 * déclenche `revalidatePath("/")`, `/sitemap.xml` et `/rss.xml`, dont la
 * compilation à froid dépassait le budget du test.
 *
 * Ce setup visite donc une fois les routes lentes — y compris celles que les
 * Server Actions revalident — avant le premier test. Sur un serveur déjà chaud
 * (exécutions locales successives), chaque requête répond en quelques
 * millisecondes et le préchauffage est transparent.
 */

const ROUTES = [
  "/",
  "/sitemap.xml",
  "/rss.xml",
  "/scores?view=finished",
  "/login",
  "/inscription",
  "/newsletter",
  // Espaces authentifiés : même sans session, la requête force la compilation
  // du layout et des routes visitées par les parcours E2E (studio, veille).
  "/studio",
  "/studio/articles",
  "/studio/articles/new",
  "/backoffice/veille",
  "/backoffice/veille/sources",
  // Routes dynamiques : les compiler avec un identifiant inexistant paie le
  // coût de compilation du motif, le temps des tests. La page répond ensuite
  // 404, ce qui est sans effet.
  "/article/e2e-warmup-introuvable",
  "/match/e2e-warmup-introuvable",
];

export default async function warmup(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
  const context = await request.newContext({ baseURL });
  const scripts = new Set<string>();
  try {
    for (const route of ROUTES) {
      // Une route qui échoue (redirection, contenu vide) n'empêche pas le
      // préchauffage des suivantes : le but est la compilation, pas le statut.
      const response = await context
        .get(route, { timeout: 240_000 })
        .catch(() => null);
      console.log(
        `[warmup] ${route} — ${response ? response.status() : "échec (ignoré)"}`,
      );
      if (response?.headers()["content-type"]?.includes("text/html")) {
        const html = await response.text();
        for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
          if (match[1].startsWith("/_next/static/")) scripts.add(match[1]);
        }
      }
    }
    // An old `next start` can render HTML from a build whose chunks were replaced.
    // HTTP 200 on the page alone then hides failed hydration and stuck actions.
    for (const script of scripts) {
      const response = await context.get(script);
      if (response.status() !== 200 || !response.headers()["content-type"]?.includes("javascript")) {
        throw new Error(
          `Build Next.js incohérent : ${script} retourne ${response.status()}. ` +
          "Arrêtez le serveur de test, terminez le build puis redémarrez-le avant de relancer Playwright.",
        );
      }
    }
    console.log(`[warmup] ${scripts.size} ressources JavaScript vérifiées`);
  } finally {
    await context.dispose();
  }
}
