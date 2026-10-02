/**
 * Agrégation des statistiques d'audience (WP8d).
 *
 * Usage :
 *   npx tsx scripts/analytics-aggregate.ts            # la veille (UTC)
 *   npx tsx scripts/analytics-aggregate.ts 2026-09-25 # une journée précise
 *
 * Calcule l'agrégat du jour (visiteurs uniques, nouveaux, récurrents, pages
 * vues et tops), l'écrit dans AnalyticsDaily (upsert sur la date), puis purge
 * les événements bruts de plus de 90 jours.
 */
import {
  RAW_EVENT_RETENTION_DAYS,
  addUtcDays,
  computeDailyAggregate,
  purgeOldPageViews,
  saveDailyAggregate,
  startOfUtcDay,
} from "../src/lib/analytics";
import { prisma } from "../src/lib/prisma";

/** Jour à agréger : argument AAAA-MM-JJ, sinon la veille. */
function parseDay(argument: string | undefined): Date | null {
  if (!argument) {
    return addUtcDays(startOfUtcDay(new Date()), -1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(argument)) {
    return null;
  }
  const parsed = new Date(`${argument}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : startOfUtcDay(parsed);
}

async function main(): Promise<void> {
  const day = parseDay(process.argv[2]);
  if (!day) {
    console.error("Date invalide : attendu AAAA-MM-JJ (ex. 2026-09-25).");
    process.exitCode = 1;
    return;
  }

  const label = day.toISOString().slice(0, 10);
  console.log(`Agrégation du ${label} (UTC)…`);

  const aggregate = await computeDailyAggregate(day);
  await saveDailyAggregate(aggregate);

  console.log(`  visiteurs uniques : ${aggregate.visitors}`);
  console.log(`  nouveaux          : ${aggregate.newVisitors}`);
  console.log(`  récurrents        : ${aggregate.returningVisitors}`);
  console.log(`  pages vues        : ${aggregate.pageViews}`);
  console.log(`  top page          : ${aggregate.topPages[0]?.path ?? "—"}`);
  console.log(`  top source        : ${aggregate.topSources[0]?.source ?? "—"}`);
  console.log(`  top article       : ${aggregate.topArticles[0]?.title ?? "—"}`);

  const cutoff = addUtcDays(startOfUtcDay(new Date()), -RAW_EVENT_RETENTION_DAYS);
  const purged = await purgeOldPageViews(cutoff);
  console.log(
    `Purge             : ${purged} page(s) vue(s) antérieure(s) au ${cutoff
      .toISOString()
      .slice(0, 10)} (rétention ${RAW_EVENT_RETENTION_DAYS} jours).`,
  );

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("ERREUR:", error);
  await prisma.$disconnect();
  process.exit(1);
});
