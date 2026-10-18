/** node prisma/seed-competitions.cjs [--production]. Updates rules only. */
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const defaults = require("./default-competitions.cjs");

async function seedCompetitions(client) {
  for (const competition of defaults) {
    const { slug, name, country, externalId, color, logoUrl, uclSpots, uelSpots, ueclSpots, relegationSpots, relegationPlayoffSpots, format } = competition;
    // Slug is stable across provider migrations. Existing metadata, identifiers,
    // seasons, teams and matches are never replaced by this rules seed.
    await client.query(`INSERT INTO "Competition" (id, name, slug, country, sport, "externalId", color, "logoUrl", "uclSpots", "uelSpots", "ueclSpots", "relegationSpots", "relegationPlayoffSpots", format, "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,'football',$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
      ON CONFLICT (slug) DO UPDATE SET "uclSpots"=EXCLUDED."uclSpots", "uelSpots"=EXCLUDED."uelSpots", "ueclSpots"=EXCLUDED."ueclSpots", "relegationSpots"=EXCLUDED."relegationSpots", "relegationPlayoffSpots"=EXCLUDED."relegationPlayoffSpots", format=EXCLUDED.format, color=EXCLUDED.color, "logoUrl"=EXCLUDED."logoUrl", "updatedAt"=NOW()`,
    [randomUUID(),name,slug,country,externalId,color,logoUrl,uclSpots,uelSpots,ueclSpots,relegationSpots,relegationPlayoffSpots,format]);
  }
}

async function main() {
  try { process.loadEnvFile(); } catch { /* Exported shell variables are supported. */ }
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--production")) throw new Error("Option : --production");
  const production = args.includes("--production");
  const connectionString = production ? process.env.DIRECT_URL?.trim() : process.env.APP_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("URL de base absente.");
  if (!production && !["localhost", "127.0.0.1"].includes(new URL(connectionString).hostname)) throw new Error("Base distante : utiliser --production explicitement.");
  const client = new Client({ connectionString });
  try {
    await client.connect(); await client.query("BEGIN");
    await seedCompetitions(client);
    await client.query("COMMIT");
    console.log(`Règles de ${defaults.length} compétitions initialisées (${production ? "production" : "local"}).`);
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { await client.end(); }
}

module.exports = { seedCompetitions };
if (require.main === module) main().catch(() => { console.error("Seed des compétitions non confirmé ; vérifier la connexion et les migrations."); process.exitCode = 1; });
