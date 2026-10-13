import { prisma } from "@/lib/prisma";
import { eventClock, fetchSyncEvents, LEAGUES, mapMatchStatus, type ApiEvent } from "@/lib/allsports-sync";
import { revalidatePath } from "next/cache";

export type SyncPriority = "live" | "upcoming" | "finished";
export type SyncResult = { synced: number; errors: string[]; duration: number; skipped?: string };
const types: SyncPriority[] = ["live", "upcoming", "finished"];
const ttl = 300000;
const inFlight = new Map<SyncPriority, Promise<SyncResult>>();

async function updateMatches(type: SyncPriority, deadline: number): Promise<SyncResult> {
  const started = Date.now();
  const now = new Date();
  const matches = await prisma.match.findMany({
    where: {
      competition: { externalId: { in: Object.values(LEAGUES).map(league => String(league.id)) } },
      externalId: { not: null },
      ...(type === "live" ? { OR: [{ status: "LIVE" }, { status: "SCHEDULED", scheduledAt: { gte: new Date(now.getTime() - 10800000), lte: now } }] } : {
        scheduledAt: { gte: new Date(now.getTime() - (type === "upcoming" ? 10800000 : 86400000)), lte: now },
        status: { in: type === "upcoming" ? ["SCHEDULED", "LIVE"] : ["SCHEDULED", "LIVE", "FINISHED"] },
      }),
    },
    select: { id: true, externalId: true, scheduledAt: true, status: true, startedAt: true, finishedAt: true, competition: { select: { externalId: true } } },
  });
  if (!matches.length) return { synced: 0, errors: [], duration: Date.now() - started, skipped: "Aucun match à synchroniser." };
  const events = new Map<number, ApiEvent>();
  const errors: string[] = [];
  if (type === "live") {
    for (const event of await fetchSyncEvents(null, { deadline })) events.set(event.id, event);
  }
  // A match disappearing from the live feed is not proof it finished.
  // Retrieve its dated feed to obtain an explicit status (including cancellations).
  const dates = new Map(matches.filter(match => type !== "live" || (match.status === "LIVE" && !events.has(Number(match.externalId))))
    .map(match => { const date=match.scheduledAt.toISOString().slice(0,10); const tournamentId=Number(match.competition.externalId); return [`${tournamentId}/${date}`, { date, tournamentId }] as const; }));
  for (const { date, tournamentId } of dates.values()) {
    try {
      for (const event of await fetchSyncEvents(date, { deadline, tournamentId })) events.set(event.id, event);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "AllSportsApi indisponible.");
      if (Date.now() + 5000 >= deadline) break;
    }
  }
  let synced = 0;
  for (const match of matches) {
    if (Date.now() + 2000 >= deadline) { errors.push("Synchronisation : limite de temps atteinte."); break; }
    const event = events.get(Number(match.externalId));
    if (!event) {
      // A due fixture not yet present in the live feed stays scheduled. Its
      // dated status is checked by the hourly upcoming job, without extra calls.
      if (type === "live" && match.status === "SCHEDULED") continue;
      errors.push(`Match ${match.id} absent des réponses fournisseur.`); continue;
    }
    try {
      const status = mapMatchStatus(event.status);
      if (!Number.isSafeInteger(event.startTimestamp) || event.startTimestamp <= 0) throw new Error(`Date fournisseur invalide pour ${match.id}.`);
      const homeScore = event.homeScore?.current ?? null;
      const awayScore = event.awayScore?.current ?? null;
      if ([homeScore, awayScore].some(score => score !== null && (!Number.isSafeInteger(score) || score < 0))) throw new Error(`Score invalide pour le match ${match.id}.`);
      // A stale cached feed must not reopen a finished match.
      if (match.status === "FINISHED" && status !== "FINISHED") continue;
      await prisma.match.update({ where: { id: match.id }, data: {
        status, homeScore, awayScore,
        scheduledAt: new Date(event.startTimestamp * 1000),
        ...(status === "LIVE" ? { startedAt: new Date(event.startTimestamp * 1000) } : {}),
        ...(status === "FINISHED" && !match.finishedAt ? { finishedAt: now } : {}),
      } });
      await prisma.syncLog.create({data:{type:`clock:${match.id}`,status:"SUCCESS",finishedAt:new Date(),errors:eventClock(event)}});
      synced++;
    } catch (error) { errors.push(error instanceof Error ? error.message : "Mise à jour du match impossible."); }
  }
  return { synced, errors, duration: Date.now() - started };
}

export const syncLiveMatches = (deadline = Date.now() + 55000) => updateMatches("live", deadline);
export const syncUpcomingMatches = (deadline = Date.now() + 55000) => updateMatches("upcoming", deadline);
export const syncFinishedMatches = (deadline = Date.now() + 55000) => updateMatches("finished", deadline);

async function run(type: SyncPriority): Promise<SyncResult> {
  const started = Date.now();
  const claim = await prisma.$transaction(async db => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(190022)`;
    const active = await db.syncLog.findFirst({ where: { type: { in: types }, finishedAt: null, startedAt: { gt: new Date(started - 65000) } } });
    const recent = await db.syncLog.findFirst({ where: { type, status: "SUCCESS", matchesSynced: { gt: 0 }, finishedAt: { gt: new Date(started - ttl) } }, orderBy: { finishedAt: "desc" } });
    const skipped = active ? "Une synchronisation est déjà en cours." : recent ? "Synchronisation récente (cache 5 minutes)." : null;
    const log = await db.syncLog.create({ data: { type, ...(skipped ? { finishedAt: new Date(), status: "SUCCESS", errors: { skipped } } : {}) } });
    return { id: log.id, skipped };
  }, { timeout: 5000, maxWait: 3000 });
  if (claim.skipped) return { synced: 0, errors: [], skipped: claim.skipped, duration: Date.now() - started };
  let result: SyncResult;
  try {
    result = await updateMatches(type, started + 55000);
  } catch (error) {
    result = { synced: 0, errors: [error instanceof Error ? error.message : "Synchronisation interrompue."], duration: Date.now() - started };
  }
  await prisma.syncLog.update({ where: { id: claim.id }, data: {
    finishedAt: new Date(), matchesSynced: result.synced,
    status: result.errors.length ? result.synced ? "PARTIAL" : "FAILED" : "SUCCESS",
    errors: result.skipped ? { skipped: result.skipped } : result.errors,
  } });
  if (result.synced) {
    revalidatePath("/scores");
    revalidatePath("/match/[id]", "page");
    revalidatePath("/competition/[slug]", "page");
  }
  return { ...result, duration: Date.now() - started };
}

export async function synchronizeSports(type: SyncPriority): Promise<SyncResult> {
  const existing = inFlight.get(type);
  if (existing) return existing;
  const promise = run(type);
  inFlight.set(type, promise);
  try { return await promise; } finally { inFlight.delete(type); }
}

/** A skipped cron is not a score update; freshness uses actual completed writes. */
export function getLastSportsUpdate(type?: SyncPriority) {
  return prisma.syncLog.findFirst({
    where: { type: type ?? { in: types }, status: { in: ["SUCCESS", "PARTIAL"] }, matchesSynced: { gt: 0 }, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" }, select: { finishedAt: true },
  });
}
