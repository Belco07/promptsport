/**
 * News Engine — collecte des alertes (WP41).
 *
 *   npx tsx scripts/fetch-news.ts
 *   npx tsx scripts/fetch-news.ts --limit=5
 *   npx tsx scripts/fetch-news.ts --source="So Foot"
 *   npx tsx scripts/fetch-news.ts --help
 *
 * En développement, la base Docker locale est joignable via la passerelle
 * WebSocket utilisée par PrismaNeon :
 *
 *   node scripts/check-wp19e.cjs --ws-proxy
 *   NEON_WS_PROXY=127.0.0.1:5443 npm run news:fetch
 *
 * En production, le script utilise Neon directement (aucun proxy).
 * Les sources YouTube nécessitent YOUTUBE_API_KEY dans l'environnement.
 */
export {};

//Capture the caller's database before reading .env, as in sync-football.ts.
const callerDatabaseUrl = process.env.DATABASE_URL;
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional when configuration is supplied by the caller.
} finally {
  if (callerDatabaseUrl !== undefined) process.env.DATABASE_URL = callerDatabaseUrl;
}

function usage(): void {
  console.log(`News Engine — collecte des alertes

Usage : npm run news:fetch -- [options]
  --limit=<n>       Éléments par source (défaut : 3, max 50)
  --source=<nom|id> Une seule source active
  --dry-run         Afficher sans enregistrer, purger ni traduire
  --help            Afficher cette aide

Configuration : DATABASE_URL (ou APP_DATABASE_URL), YOUTUBE_API_KEY pour YouTube,
DEEPSEEK_API_KEY pour la traduction. NEON_WS_PROXY est réservé à Docker local.
X_BEARER_TOKEN pour X ; META_ACCESS_TOKEN pour Facebook/Instagram ;
META_IG_USER_ID pour Instagram ; META_GRAPH_VERSION pour la version Meta.`);
}

function readOption(args: string[], name: string): string | undefined {
  const withEquals = args.find(arg => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { usage(); return; }
  const rawLimit = readOption(args, "limit");
  const limit = rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);
  if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) throw new Error("--limit doit être un entier supérieur à zéro.");
  const { prisma } = await import("../src/lib/prisma");
  try {
    const { fetchNews } = await import("../src/lib/news-fetcher");
    const result = await fetchNews({ limit, source: readOption(args, "source"), dryRun: args.includes("--dry-run") });
    if (result.sourcesProcessed > 0 && result.sourcesFailed === result.sourcesProcessed) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error("[veille] Erreur fatale :", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
