/** Verify public CDN images and fill missing AllSports team logos. No sports API calls. */
import { mkdir, writeFile } from "node:fs/promises";

process.loadEnvFile();
const args = new Set(process.argv.slice(2));
const production = args.has("--production");
const apply = args.has("--apply");
if ([...args].some(arg => !["--production", "--apply"].includes(arg))) throw new Error("Options : --production --apply");
if (production) {
  if (!process.env.DIRECT_URL?.trim()) throw new Error("DIRECT_URL absente.");
  process.env.APP_DATABASE_URL = process.env.DIRECT_URL;
} else {
  const target = process.env.APP_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!target || !["localhost", "127.0.0.1"].includes(new URL(target).hostname)) throw new Error("Base distante : utiliser explicitement --production.");
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  try {
    const missing = await prisma.team.findMany({ where: { logoUrl: null }, select: { id: true, name: true, slug: true, externalId: true, logoUrl: true } });
    // Suffixed slugs identify teams created by the AllSports importer. Legacy
    // football-data identifiers belong to another namespace and cannot be reused.
    const candidates = missing.filter(team => team.externalId && /^\d+$/.test(team.externalId) && team.slug.endsWith(`-${team.externalId}`));
    const verified: Array<{ id: string; name: string; logoUrl: string }> = [];
    const unavailable: string[] = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < candidates.length) {
        const team = candidates[cursor++];
        const url = `https://img.sofascore.com/api/v1/team/${team.externalId}/image`;
        let valid = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(12000) });
            valid = response.ok && Boolean(response.headers.get("content-type")?.startsWith("image/"));
            if (valid || response.status === 404) break;
          } catch { /* A failed public image never overwrites the stored logo. */ }
        }
        if (valid) verified.push({ id: team.id, name: team.name, logoUrl: url });
        else unavailable.push(team.name);
      }
    }));
    let updated = 0;
    if (apply && verified.length) {
      await mkdir("backups", { recursive: true });
      const backup = `backups/team-logos-${production ? "production" : "local"}-${Date.now()}.json`;
      await writeFile(backup, JSON.stringify(missing, null, 2));
      console.log(`Sauvegarde : ${backup}`);
      await prisma.$transaction(async db => {
        for (const team of verified) {
          const result = await db.team.updateMany({ where: { id: team.id, logoUrl: null }, data: { logoUrl: team.logoUrl } });
          updated += result.count;
        }
      }, { timeout: 60000 });
    }
    console.log(JSON.stringify({ target: production ? "production" : "local", apply, missing: missing.length, candidates: candidates.length, verified: verified.length, updated, unavailable, skipped: missing.filter(team => !candidates.includes(team)).map(team => team.name), remaining: await prisma.team.count({ where: { logoUrl: null } }), sportsApiRequests: 0 }));
  } finally { await prisma.$disconnect(); }
}

main().catch(() => { console.error("Réparation des logos non confirmée ; vérifier la connexion ou les images publiques."); process.exitCode = 1; });
