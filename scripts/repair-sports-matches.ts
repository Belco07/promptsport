/**
 * WP19e. Read-only by default, with zero API calls:
 *   npx tsx scripts/repair-sports-matches.ts --production
 * Apply with a strict total budget (shared with parallel calls and retries):
 *   npx tsx scripts/repair-sports-matches.ts --production --apply --max-requests=40
 * Backups are written before changes. Existing leagues are not reimported.
 */
import fs from "node:fs/promises";
import { basename } from "node:path";

async function main() {
  try { process.loadEnvFile(); } catch { /* Shell configuration is also supported. */ }
  const args = process.argv.slice(2);
  if (args.includes("--production")) {
    if (!process.env.DIRECT_URL?.trim()) throw new Error("DIRECT_URL requise pour --production.");
    process.env.APP_DATABASE_URL = process.env.DIRECT_URL;
  }
  const maximum = Number(args.find(arg => arg.startsWith("--max-requests="))?.split("=")[1] ?? 40);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 80) throw new Error("--max-requests doit être compris entre 1 et 80.");
  const { prisma } = await import("../src/lib/prisma");
  const { LEAGUES, prepareCompetition, persistCompetition, withSportsRequestBudget, getQuotaRemaining } = await import("../src/lib/allsports-sync");
  const { syncOrphanMatches, backfillMatchTimestamps } = await import("../src/lib/live-sync");
  try {
    await prisma.$queryRaw`SELECT 1`;
    const before = {
      orphanCount: await prisma.match.count({ where: { status: "SCHEDULED", scheduledAt: { lt: new Date() } } }),
      missingTimestamps: await prisma.match.count({ where: { status: "FINISHED", OR: [{ startedAt: null }, { finishedAt: null }] } }),
      competitions: await prisma.competition.findMany({ select: { externalId: true, name: true, _count: { select: { matches: true } } } }),
    };
    if (!args.includes("--apply")) { console.log(JSON.stringify({ mode: "read-only", ...before, providerRequests: 0 })); return; }
    await fs.mkdir("backups", { recursive: true });
    const backup = `backups/wp19e-${args.includes("--production") ? "production" : "local"}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await fs.writeFile(backup, JSON.stringify({ observedAt: new Date(), matches: await prisma.match.findMany(), teams: await prisma.team.findMany(), competitions: await prisma.competition.findMany() }));
    const timestampsUpdated = await backfillMatchTimestamps();
    console.log(JSON.stringify({ phase: "backup", backup, timestampsUpdated, maximumRequests: maximum }));
    const errors: string[] = [];
    const report = await withSportsRequestBudget(maximum, async () => {
      const repair = await syncOrphanMatches(Date.now() + 300000);
      console.log(JSON.stringify({ phase: "orphans", ...repair }));
      errors.push(...repair.errors);
      await prisma.syncLog.create({ data: { type: "finished", status: repair.errors.length ? repair.synced ? "PARTIAL" : "FAILED" : "SUCCESS", finishedAt: new Date(), matchesSynced: repair.synced, errors: { repair: "WP19e", details: repair.errors, timestampsUpdated, timestampMeaning: "Stored kickoff; finishedAt records when the terminal status was observed." } } });
      const imported = [];
      for (const code of ["EL", "ECL"] as const) {
        const existing = await prisma.competition.findUnique({ where: { externalId: String(LEAGUES[code].id) }, select: { _count: { select: { matches: true } } } });
        if (existing && existing._count.matches > 0) { imported.push({ code, skipped: "Déjà importée" }); continue; }
        try {
          // Last page + upcoming pages only: enough to activate these leagues
          // without spending the free quota on every qualification round.
          const prepared = await prepareCompetition(code, { recentOnly: true });
          const result = await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(190020)`;
            return persistCompetition(tx, prepared);
          }, { timeout: 180000 });
          imported.push(result);
          console.log(JSON.stringify({ phase: "import", ...result }));
        } catch (error) {
          errors.push(`${code} : ${error instanceof Error ? error.message : "Import interrompu."}`);
        }
      }
      return { repair, imported };
    });
    const after = {
      orphanCount: await prisma.match.count({ where: { status: "SCHEDULED", scheduledAt: { lt: new Date() } } }),
      missingTimestamps: await prisma.match.count({ where: { status: "FINISHED", OR: [{ startedAt: null }, { finishedAt: null }] } }),
    };
    console.log(JSON.stringify({ backup, before, timestampsUpdated, ...report, after, errors, providerRemaining: getQuotaRemaining() }));
    if (errors.length) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
if (basename(process.argv[1] ?? "") === "repair-sports-matches.ts") {
  main().catch(() => { console.error("Réparation interrompue : vérifier la connexion, la clé et le quota. La sauvegarde est conservée."); process.exitCode = 1; });
}
