/** Dry-run by default. --confirm-reset explicitly authorizes replacement. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_COMPETITIONS, prepareCompetition, persistCompetition } from "../src/lib/api-football-sync";

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--confirm-reset")) throw new Error("Usage : npx tsx scripts/migrate-sports-data.ts [--confirm-reset]");
  const counts = { competitions: await prisma.competition.count(), teams: await prisma.team.count(), matches: await prisma.match.count() };
  console.log("Tables sportives qui seraient remplacées :", counts);
  if (!args.includes("--confirm-reset")) {
    console.log("Simulation uniquement : aucune écriture et aucun appel API. Après accord, ajouter --confirm-reset.");
    return;
  }
  console.log("Prévalidation API des six compétitions : aucune donnée locale supprimée à ce stade.");
  const prepared: Awaited<ReturnType<typeof prepareCompetition>>[] = [];
  for (const code of DEFAULT_COMPETITIONS) prepared.push(await prepareCompetition(code));
  const directory = path.resolve("backups");
  await mkdir(directory, { recursive: true });
  const backup = path.join(directory, `sports-before-api-football-${Date.now()}.json`);
  const results = await prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(190019)`;
    // Block concurrent manual CRUD while taking the backup and replacing data.
    await db.$executeRaw`LOCK TABLE "Match", "Team", "Competition" IN ACCESS EXCLUSIVE MODE`;
    const snapshot = { createdAt: new Date().toISOString(), competitions: await db.competition.findMany(), teams: await db.team.findMany(), matches: await db.match.findMany() };
    await writeFile(backup, JSON.stringify(snapshot, null, 2), { flag: "wx", mode: 0o600 });
    await db.match.deleteMany();
    await db.team.deleteMany();
    await db.competition.deleteMany();
    const results = [];
    for (const item of prepared) results.push(await persistCompetition(db, item));
    return results;
  }, { timeout: 180000, maxWait: 10000 });
  console.log("Sauvegarde :", backup);
  console.table(results);
  console.log("Migration validée. Redémarrer le serveur Next.js pour renouveler les données mises en cache.");
}
main().catch(error => { console.error("Migration annulée :", error instanceof Error ? error.message : "erreur inconnue"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
