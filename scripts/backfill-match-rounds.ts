/** Recover round metadata from existing import checkpoints; never calls a sports API. */
import fs from "node:fs/promises";

async function main() {
  try { process.loadEnvFile(); } catch { /* Shell variables supported. */ }
  const args = new Set(process.argv.slice(2)), production = args.has("--production"), apply = args.has("--apply");
  if ([...args].some(arg => !["--production", "--apply"].includes(arg))) throw new Error("Options : --production --apply");
  if (production) { if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL absente"); process.env.APP_DATABASE_URL = process.env.DIRECT_URL; }
  else if (!["localhost","127.0.0.1"].includes(new URL(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || "").hostname)) throw new Error("Base locale requise sans --production");
  const { prisma } = await import("../src/lib/prisma");
  const { Prisma } = await import("../src/generated/prisma/client");
  const { LEAGUES, eventRoundInfo } = await import("../src/lib/allsports-sync");
  const updates: Array<{ id: string; matchday: number | null; roundName: string | null }> = [];
  try {
    for (const code of ["FL1","PL","PD","SA","BL1","CL"] as const) {
      const checkpoint = JSON.parse(await fs.readFile(`backups/allsports-prepared-${code}.json`, "utf8")) as { item: import("../src/lib/allsports-sync").PreparedCompetition };
      const competition = await prisma.competition.findUnique({ where: { slug: LEAGUES[code].slug }, select: { id: true, season: true } });
      if (!competition || competition.season !== checkpoint.item.season.year) continue;
      const events = new Map(checkpoint.item.events.map(event => [String(event.id), event]));
      const matches = await prisma.match.findMany({ where: { competitionId: competition.id, externalId: { in: [...events.keys()] }, matchday: null, roundName: null }, select: { id: true, externalId: true } });
      for (const match of matches) {
        const info = eventRoundInfo(events.get(match.externalId!)!);
        if (info.matchday || info.roundName) updates.push({ id: match.id, matchday: info.matchday ?? null, roundName: info.roundName ?? null });
      }
    }
    let updated = 0;
    if (apply && updates.length) {
      await fs.mkdir("backups", { recursive: true });
      const backup = `backups/match-rounds-${production ? "production" : "local"}-${Date.now()}.json`;
      await fs.writeFile(backup, JSON.stringify(updates.map(row => ({ id: row.id, matchday: null, roundName: null }))), { mode: 0o600 });
      console.log(`Sauvegarde : ${backup}`);
      updated = await prisma.$executeRaw(Prisma.sql`UPDATE "Match" AS m SET "matchday"=v.day, "roundName"=v.name, "updatedAt"=NOW() FROM (VALUES ${Prisma.join(updates.map(row => Prisma.sql`(${row.id}::text, ${row.matchday}::integer, ${row.roundName}::text)`))}) AS v(id,day,name) WHERE m.id=v.id AND m."matchday" IS NULL AND m."roundName" IS NULL`);
    }
    console.log(JSON.stringify({ target: production ? "production" : "local", apply, candidates: updates.length, updated, sportsApiRequests: 0 }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Récupération des journées non confirmée : vérifier les sauvegardes, la connexion et la migration."); process.exitCode = 1; });
