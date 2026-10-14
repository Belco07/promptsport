import { createHash } from "node:crypto";
import { basename } from "node:path";
import { cleanPlayerName, playerProfileKey, slugify } from "../src/lib/slug";
import type { PrismaClient } from "../src/generated/prisma/client";

/** No provider requests. The lock and stable slugs make repeated runs safe. */
export async function extractPlayers(db: PrismaClient) {
  await db.$queryRaw`SELECT 1`;
  const [events, teams, lineups] = await Promise.all([
    db.matchEvent.findMany({ orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { teamId: true, playerName: true, assistName: true } }),
    db.team.findMany({ select: { id: true, slug: true } }),
    db.matchLineup.findMany({ orderBy: { createdAt: "desc" }, select: { teamId: true, starters: true, substitutes: true } }),
  ]);
  const teamSlugs = new Map(teams.map(team => [team.id, team.slug]));
  const candidates = new Map<string, { name: string; teamId: string; position: string | null }>();
  const positions = new Map<string, string>();
  const positionNames: Record<string, string> = { G: "Gardien", D: "Défenseur", M: "Milieu", F: "Attaquant" };
  for (const lineup of lineups) {
    for (const list of [lineup.starters, lineup.substitutes]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string" || typeof item.position !== "string") continue;
        const key = playerProfileKey(lineup.teamId, item.name);
        const position = positionNames[item.position];
        if (position && !positions.has(key)) positions.set(key, position);
      }
    }
  }
  for (const event of events) {
    if (!teamSlugs.has(event.teamId)) continue;
    for (const raw of [event.playerName, event.assistName]) {
      const name = cleanPlayerName(raw);
      if (!name) continue;
      const key = playerProfileKey(event.teamId, name);
      if (!candidates.has(key)) candidates.set(key, { name, teamId: event.teamId, position: positions.get(key) ?? null });
    }
  }
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(210021)`;
    const existing = await tx.player.findMany();
    const identities = new Map(existing.map(player => [playerProfileKey(player.teamId, player.name), player]));
    const slugs = new Set(existing.map(player => player.slug));
    const additions: { name: string; slug: string; teamId: string; position: string | null }[] = [];
    let updated = 0;
    for (const [key, player] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
      const known = identities.get(key);
      if (known) {
        if (!known.position && player.position) { await tx.player.update({ where: { id: known.id }, data: { position: player.position } }); updated++; }
        continue;
      }
      const base = slugify(player.name) || `joueur-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
      let slug = base;
      if (slugs.has(slug)) slug = `${base}-${teamSlugs.get(player.teamId)}`;
      let suffix = 2;
      while (slugs.has(slug)) slug = `${base}-${teamSlugs.get(player.teamId)}-${suffix++}`;
      slugs.add(slug);
      additions.push({ ...player, slug });
    }
    if (additions.length) await tx.player.createMany({ data: additions });
    return { events: events.length, identified: candidates.size, created: additions.length, updated, providerRequests: 0 };
  }, { timeout: 60000, maxWait: 10000 });
}

async function main() {
  try { process.loadEnvFile(); } catch { /* Shell environment can supply the URLs. */ }
  if (process.argv.includes("--production")) {
    if (!process.env.DIRECT_URL?.trim()) throw new Error("DIRECT_URL requise pour --production.");
    process.env.APP_DATABASE_URL = process.env.DIRECT_URL;
  }
  const { prisma } = await import("../src/lib/prisma");
  try { console.log(JSON.stringify(await extractPlayers(prisma))); }
  finally { await prisma.$disconnect(); }
}
if (basename(process.argv[1] ?? "") === "extract-players.ts") {
  main().catch(() => { console.error("Extraction interrompue : vérifier la migration Player et la connexion à la base."); process.exitCode = 1; });
}
