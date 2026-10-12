/** Explicit provider migration. Default: read-only inspection; --confirm-migration writes. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Prisma } from "../src/generated/prisma/client";
import type { PreparedCompetition } from "../src/lib/allsports-sync";

const callerDatabaseUrl = process.env.DATABASE_URL;
try { process.loadEnvFile?.(); } catch { /* Environment-only configuration is supported. */ }
finally { if (callerDatabaseUrl !== undefined) process.env.DATABASE_URL = callerDatabaseUrl; }

const LEGACY_IDS: Record<string, string> = { FL1: "2015", PL: "2021", PD: "2014", SA: "2019", BL1: "2002", CL: "2001" };

function teamKey(name: string): string {
  const key = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\b(fc|cf|afc|sc|sv|ac|as|tsg|04|1)\b/g, " ").replace(/\s+/g, " ").trim();
  const aliases: Record<string, string> = {
    "bayern munchen": "bayern munich", "borussia monchengladbach": "borussia m gladbach",
    "manchester utd": "manchester united", "man utd": "manchester united", "man united": "manchester united",
    "man city": "manchester city", "inter milan": "internazionale", "inter": "internazionale",
    "milan": "milan", "paris sg": "paris saint germain", "psg": "paris saint germain",
    "sporting clube de portugal": "sporting cp", "sporting": "sporting cp",
    "athletic club": "athletic bilbao", "athletic": "athletic bilbao",
    "real sociedad de futbol": "real sociedad", "rcd espanyol de barcelona": "espanyol", "rcd espanyol": "espanyol",
    "tottenham": "tottenham hotspur", "wolves": "wolverhampton wanderers",
  };
  return aliases[key] ?? key;
}

/** Preserve internal competition/team IDs, logos and reader follows where names match. */
export async function migratePreparedCompetitions(db: Prisma.TransactionClient, prepared: PreparedCompetition[]) {
  const { LEAGUES, DEFAULT_COMPETITIONS, persistCompetition } = await import("../src/lib/allsports-sync");
  if (prepared.length !== DEFAULT_COMPETITIONS.length || new Set(prepared.map(item => item.code)).size !== DEFAULT_COMPETITIONS.length) throw new Error("Les six compétitions doivent être préparées avant la migration.");
  const competitions = await db.competition.findMany();
  if (competitions.some(row => row.externalId && !Object.values(LEGACY_IDS).includes(row.externalId))) throw new Error("La base contient déjà un autre fournisseur. Utilisez la synchronisation normale ou vérifiez la base cible.");
  const teams = await db.team.findMany();
  const matches = await db.match.findMany();
  const sourceTeams = new Map(prepared.flatMap(item => [...item.teams, ...item.events.flatMap(event => [event.homeTeam, event.awayTeam])]).map(team => [team.id, team]));
  const used = new Set<string>();
  const mapping = new Map<number, string>();
  const rows: { id: string; name: string; oldExternalId: string | null; externalId: string }[] = [];
  for (const team of sourceTeams.values()) {
    const keys = new Set([teamKey(team.name), teamKey(team.shortName ?? "")].filter(Boolean));
    const candidates = teams.filter(old => !used.has(old.id) && [teamKey(old.name), teamKey(old.shortName ?? "")].some(key => key && keys.has(key)));
    if (candidates.length > 1) throw new Error(`Correspondance ambiguë pour ${team.name}. Aucune écriture validée.`);
    if (candidates.length === 1) {
      const old = candidates[0]; used.add(old.id); mapping.set(team.id, old.id);
      rows.push({ id: old.id, name: old.name, oldExternalId: old.externalId, externalId: String(team.id) });
    }
  }
  // Release old numeric identifiers before assigning the new provider's numbers.
  await db.$executeRaw`UPDATE "Team" SET "externalId" = 'legacy:football-data:' || "externalId" WHERE "externalId" IS NOT NULL`;
  await db.$executeRaw`UPDATE "Match" SET "externalId" = 'legacy:football-data:' || "externalId" WHERE "externalId" IS NOT NULL`;
  for (const row of rows) await db.team.update({ where: { id: row.id }, data: { externalId: row.externalId } });
  let reusedMatches = 0;
  const assignedMatches = new Set<string>();
  for (const item of prepared) {
    const league = LEAGUES[item.code];
    const old = competitions.find(row => row.externalId === LEGACY_IDS[item.code]);
    if (old) {
      await db.competition.update({ where: { id: old.id }, data: { externalId: String(league.id) } });
      for (const event of item.events) {
        const home = mapping.get(event.homeTeam.id), away = mapping.get(event.awayTeam.id);
        if (!home || !away) continue;
        const candidates = matches.filter(match => !assignedMatches.has(match.id) && match.externalId && match.competitionId === old.id && match.homeTeamId === home && match.awayTeamId === away && Math.abs(match.scheduledAt.getTime() - event.startTimestamp * 1000) < 86400000);
        if (candidates.length === 1) {
          await db.match.update({ where: { id: candidates[0].id }, data: { externalId: String(event.id) } });
          assignedMatches.add(candidates[0].id); reusedMatches++;
        }
      }
    }
  }
  const results = [];
  for (const item of prepared) results.push(await persistCompetition(db, item));
  return { results, mapping: rows, reusedTeams: mapping.size, reusedMatches, retainedLegacyTeams: teams.length - used.size };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--confirm-migration")) throw new Error("Usage : npx tsx scripts/migrate-allsports-data.ts [--confirm-migration]");
  const { prisma } = await import("../src/lib/prisma");
  try {
    const counts = { competitions: await prisma.competition.count(), teams: await prisma.team.count(), matches: await prisma.match.count() };
    const identity = await prisma.$queryRaw<{ database: string }[]>`SELECT current_database() AS database`;
    console.log("Base cible :", identity[0].database, "—", counts);
    if (!args.includes("--confirm-migration")) { console.log("Simulation : aucune écriture ni requête API."); return; }
    const { DEFAULT_COMPETITIONS, LEAGUES, prepareCompetition, mapMatchStatus, fetchSeasons, getQuotaRemaining } = await import("../src/lib/allsports-sync");
    const foreign = await prisma.competition.findMany({ where: { externalId: { not: null, notIn: Object.values(LEGACY_IDS) } }, select: { id: true } });
    if (foreign.length) throw new Error("Base déjà migrée ou fournisseur inattendu. Aucune donnée modifiée.");
    await fetchSeasons(LEAGUES.FL1.id);
    const remaining = getQuotaRemaining();
    console.log("Quota réel AllSportsApi restant :", remaining);
    if (remaining === null) throw new Error("Quota réel non vérifiable : import reporté.");
    if (remaining < 40) throw new Error("Moins de 40 requêtes restantes : import à reporter demain.");
    const directory = path.resolve("backups");
    await mkdir(directory, { recursive: true });
    const prepared: PreparedCompetition[] = [];
    for (const code of DEFAULT_COMPETITIONS) {
      const checkpoint = path.join(directory, `allsports-prepared-${code}.json`);
      let item: PreparedCompetition | undefined;
      try {
        const saved = JSON.parse(await readFile(checkpoint, "utf8"));
        if (saved.completeHistory === true && saved.item?.code === code && Date.now() - saved.savedAt >= 0 && Date.now() - saved.savedAt < 21600000) item = saved.item;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!item) {
        console.log(`Préparation ${code} (historique complet, fenêtre configurée des matchs à venir)…`);
        item = await prepareCompetition(code);
        await writeFile(checkpoint, JSON.stringify({ savedAt: Date.now(), completeHistory: true, item }), { mode: 0o600 });
      }
      if (!item.teams.length || !item.events.length || !item.season?.year) throw new Error(`${code} : données incomplètes.`);
      for (const event of item.events) mapMatchStatus(event.status);
      prepared.push(item);
      console.log(`${code} : ${item.teams.length} équipes, ${item.events.length} matchs, saison ${item.season.year}.`);
    }
    const target = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || (target.port && target.port !== "5432")) throw new Error("La sauvegarde Docker prévue concerne uniquement PostgreSQL local sur 5432.");
    const stamp = Date.now();
    const dumpPath = path.join(directory, `promptsport-before-allsports-${stamp}.dump`);
    const dump = execFileSync("docker", ["exec", "promptsport-pg", "pg_dump", "-U", decodeURIComponent(target.username), "-d", identity[0].database, "-Fc"], { maxBuffer: 100 * 1024 * 1024 });
    const toc = execFileSync("docker", ["exec", "-i", "promptsport-pg", "pg_restore", "--list"], { input: dump, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (!["Team", "Competition", "Match", "Author"].every(table => toc.includes(`TABLE DATA public ${table} `))) throw new Error("Sauvegarde PostgreSQL incomplète.");
    await writeFile(dumpPath, dump, { flag: "wx", mode: 0o600 });
    console.log("Sauvegarde PostgreSQL vérifiée :", dumpPath);
    const snapshotPath = path.join(directory, `sports-before-allsports-${stamp}.json`);
    const result = await prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(190020)`;
      await db.$executeRaw`LOCK TABLE "Match", "Team", "Competition", "_ReaderFollowedTeams", "_ReaderFollowedCompetitions" IN ACCESS EXCLUSIVE MODE`;
      const snapshot = { createdAt: new Date().toISOString(), competitions: await db.competition.findMany(), teams: await db.team.findMany(), matches: await db.match.findMany(), follows: await db.author.findMany({ select: { id: true, favoriteCompetitions: true, followedTeams: { select: { id: true } }, followedCompetitions: { select: { id: true } } } }) };
      await writeFile(snapshotPath, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 });
      return migratePreparedCompetitions(db, prepared);
    }, { timeout: 180000, maxWait: 10000 });
    await writeFile(path.join(directory, `allsports-migration-result-${stamp}.json`), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
    console.table(result.results);
    console.log("Identifiants internes conservés :", result.reusedTeams, "équipes et", result.reusedMatches, "matchs. Clubs anciens conservés :", result.retainedLegacyTeams);
    console.log("Migration terminée. Sauvegarde des données sportives et suivis :", snapshotPath);
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1]?.endsWith("migrate-allsports-data.ts")) main().catch(error => {
  console.error("Migration annulée :", error instanceof Error ? error.message : "erreur inconnue");
  process.exitCode = 1;
});
