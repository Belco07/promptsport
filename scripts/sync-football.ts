/**
 * Synchronisation des compétitions — AllSportsApi (WP19a-bis).
 *
 *   npx tsx scripts/sync-football.ts                 # toutes les compétitions suivies
 *   npx tsx scripts/sync-football.ts FL1 PL          # seulement celles-ci
 *   npx tsx scripts/sync-football.ts FL1 --dry-run   # prépare sans écrire en base
 *
 * `--dry-run` interroge l'API et affiche ce qui serait importé (saison, équipes,
 * matchs, statuts) sans aucune écriture : c'est le mode à utiliser tant que la
 * bascule depuis football-data.org n'a pas été confirmée.
 *
 * Le service de repli `src/lib/api-football-sync.ts` reste disponible ; il n'est
 * plus utilisé par ce script.
 */
// Capture the caller's database before reading .env. Service imports must happen
// afterwards: importing Prisma statically would construct its client too early.
export {};
const callerDatabaseUrl = process.env.DATABASE_URL;
try {
  process.loadEnvFile?.();
} catch {
  // .env is optional when configuration is supplied by the caller.
} finally {
  if (callerDatabaseUrl !== undefined) process.env.DATABASE_URL = callerDatabaseUrl;
}

let prisma: typeof import("../src/lib/prisma")["prisma"] | undefined;

async function main() {
  const { prisma: client } = await import("../src/lib/prisma");
  prisma = client;
  const { DEFAULT_COMPETITIONS, LEAGUES, mapMatchStatus, prepareCompetition, syncAllCompetitions } = await import("../src/lib/allsports-sync");
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const codes = args.filter((arg) => !arg.startsWith("--"));

  console.log(
    dryRun
      ? "Préparation AllSportsApi (mode --dry-run : aucune écriture en base)…"
      : "Synchronisation AllSportsApi (RapidAPI)…",
  );
  console.log(`Compétitions : ${(codes.length ? codes : DEFAULT_COMPETITIONS).join(", ")}\n`);

  if (dryRun) {
    let failures = 0;
    for (const input of codes.length ? codes : DEFAULT_COMPETITIONS) {
      try {
        const prepared = await prepareCompetition(input);
        const statuses = new Map<string, number>();
        let live = 0;
        let scored = 0;
        for (const event of prepared.events) {
          const status = mapMatchStatus(event.status);
          statuses.set(status, (statuses.get(status) ?? 0) + 1);
          if (status === "LIVE") live += 1;
          if (event.homeScore?.current !== undefined && event.homeScore?.current !== null) scored += 1;
        }
        const league = LEAGUES[prepared.code];
        console.log(
          `OK    | ${prepared.code} — ${league.name} (id ${league.id}) · saison ${prepared.season.year} (id ${prepared.season.id})`,
        );
        console.log(
          `        équipes : ${prepared.teams.length} | matchs : ${prepared.events.length} (${scored} avec score, ${live} en direct) | statuts : ${[...statuses].map(([key, value]) => `${key}=${value}`).join(", ")}`,
        );
      } catch (error) {
        failures += 1;
        console.error(`ECHEC | ${input} : ${error instanceof Error ? error.message : "Erreur inconnue"}`);
      }
    }
    console.log(`\nMode --dry-run terminé : ${failures === 0 ? "aucune erreur" : `${failures} erreur(s)`}.`);
    if (failures > 0) process.exitCode = 1;
    return;
  }

  const summary = await syncAllCompetitions(codes.length ? codes : undefined);
  console.table(summary.results);
  console.log(
    `${summary.competitions} compétition(s), ${summary.teams} équipe(s), ${summary.matches} match(s), ${summary.errors.length} erreur(s).`,
  );
  // Les échecs partiels doivent aussi être visibles pour un futur planificateur.
  if (summary.errors.length || !summary.competitions) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "Erreur de synchronisation");
    process.exitCode = 1;
  })
  .finally(() => prisma?.$disconnect());
