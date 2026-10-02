/**
 * Script CLI de synchronisation football (WP6e).
 *
 * Exécution : npm run sync:football
 *         ou : npx tsx scripts/sync-football.ts
 *
 * Ce script est destiné à être déclenché par un cron job lors du déploiement
 * (WP12). Il synchronise les compétitions de DEFAULT_COMPETITIONS depuis
 * Football-Data.org et affiche un résumé.
 *
 * Code de sortie : 0 si au moins une compétition a été synchronisée,
 * 1 si toutes ont échoué (permet au cron de détecter un incident).
 */
import { syncAllCompetitions } from "../src/lib/football-sync";

async function main() {
  const startedAt = Date.now();
  console.log("Synchronisation Football-Data.org…");
  console.log("");

  const summary = await syncAllCompetitions();

  for (const result of summary.results) {
    console.log(
      `  ✓ ${result.name} (${result.code}) : ${result.teams} équipe(s), ${result.matches} match(s)`,
    );
  }

  for (const error of summary.errors) {
    console.error(`  ✗ ${error}`);
  }

  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("");
  console.log("Résumé");
  console.log(`  Compétitions : ${summary.competitions}`);
  console.log(`  Équipes      : ${summary.teams}`);
  console.log(`  Matchs       : ${summary.matches}`);
  console.log(`  Erreurs      : ${summary.errors.length}`);
  console.log(`  Durée        : ${durationS}s`);

  if (summary.competitions === 0) {
    console.error("");
    console.error("ECHEC : aucune compétition n'a pu être synchronisée.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("ECHEC :", error instanceof Error ? error.message : error);
  process.exit(1);
});
