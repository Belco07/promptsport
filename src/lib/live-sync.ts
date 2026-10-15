import { prisma } from "@/lib/prisma";
import { AllSportsHttpError, eventClock, eventRoundInfo, fetchMatchEvent, fetchSyncEvents, LEAGUES, mapMatchStatus, type ApiEvent } from "@/lib/allsports-sync";
import { revalidatePath } from "next/cache";

export type SyncPriority = "live" | "upcoming" | "finished";
export type SyncResult = { synced: number; errors: string[]; duration: number; skipped?: string };
const types: SyncPriority[] = ["live", "upcoming", "finished"];
const ttl = 300000;
const inFlight = new Map<SyncPriority, Promise<SyncResult>>();

async function updateMatches(type: SyncPriority | "orphans", deadline: number): Promise<SyncResult> {
  const started = Date.now(), now = new Date();
  const events = new Map<number, ApiEvent>();
  const errors: string[] = [];
  if (type === "live") {
    for (const event of await fetchSyncEvents(null, { deadline })) {
      if (!Number.isSafeInteger(event.id) || event.id <= 0) { errors.push("AllSportsApi : identifiant de match invalide dans le flux live."); continue; }
      events.set(event.id, event);
    }
  }
  const matches = await prisma.match.findMany({
    where: type === "orphans" ? { status: "SCHEDULED", scheduledAt: { lt: now } } : type === "live" ? {
      OR: [{ externalId: { in: [...events.keys()].map(String) } }, { status: "LIVE" }, { status: "SCHEDULED", scheduledAt: { lt: now } }],
    } : {
      competition: { externalId: { in: Object.values(LEAGUES).map(league => String(league.id)) } },
      ...(type === "upcoming" ? { status: { in: ["SCHEDULED", "LIVE"] }, scheduledAt: { lte: now } } : {
        OR: [{ status: "SCHEDULED", scheduledAt: { lte: now } }, { status: { in: ["LIVE", "FINISHED"] }, scheduledAt: { gte: new Date(now.getTime() - 86400000), lte: now } }],
      }),
    },
    select: { id: true, externalId: true, scheduledAt: true, status: true, startedAt: true, finishedAt: true, competition: { select: { externalId: true } } },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });
  if (!matches.length) return { synced: 0, errors, duration: Date.now() - started, ...(errors.length ? {} : { skipped: "Aucun match à synchroniser." }) };
  let synced = 0;
  const apply = async (match: typeof matches[number], event: ApiEvent | null) => {
    try {
      const status = event ? mapMatchStatus(event.status) : "FINISHED";
      if (event && (!Number.isSafeInteger(event.startTimestamp) || event.startTimestamp <= 0)) throw new Error("Date fournisseur invalide.");
      const homeScore = event?.homeScore?.current ?? null, awayScore = event?.awayScore?.current ?? null;
      if ([homeScore, awayScore].some(score => score !== null && (!Number.isSafeInteger(score) || score < 0))) throw new Error("Score fournisseur invalide.");
      if (match.status === "FINISHED" && status !== "FINISHED") return;
      const kickoff = event ? new Date(event.startTimestamp * 1000) : match.scheduledAt;
      // Guard the administrative 404 fallback against a concurrent live update.
      const result = await prisma.match.updateMany({ where: { id: match.id, ...(!event ? { status: "SCHEDULED" as const } : status !== "FINISHED" ? { status: { not: "FINISHED" as const } } : {}) }, data: {
        status, homeScore, awayScore, scheduledAt: kickoff,
        ...(event ? eventRoundInfo(event) : {}),
        ...(status === "LIVE" || status === "FINISHED" ? { startedAt: match.startedAt ?? kickoff } : {}),
        ...(status === "FINISHED" ? { finishedAt: match.finishedAt ?? new Date() } : {}),
      } });
      if (!result.count) return;
      await prisma.syncLog.create({ data: { type: `clock:${match.id}`, status: "SUCCESS", finishedAt: new Date(), errors: event ? eventClock(event) : { minute: null, observedAt: new Date().toISOString(), running: false, periodEnd: null, unknownResult: true } } });
      if (!event) await prisma.syncLog.create({ data: { type: `orphan:${match.id}`, status: "SUCCESS", finishedAt: new Date(), matchesSynced: 1, errors: { reason: match.externalId && /^\d+$/.test(match.externalId) ? "PROVIDER_NOT_FOUND" : "NO_PROVIDER_REFERENCE", unknownResult: true, timestamps: "Kickoff stored in scheduledAt; finishedAt records this observation, not the final whistle." } } });
      synced++;
    } catch (error) { errors.push(`${match.id} : ${error instanceof Error ? error.message : "Mise à jour impossible."}`); }
  };
  const pending = new Map<string, typeof matches>();
  for (const match of matches) {
    const event = events.get(Number(match.externalId));
    if (event) { await apply(match, event); continue; }
    const key = `${match.competition.externalId}/${match.scheduledAt.toISOString().slice(0, 10)}`;
    pending.set(key, [...(pending.get(key) ?? []), match]);
  }
  // Apply each calendar immediately, so one slow competition cannot prevent
  // completed groups from being written before the serverless deadline.
  for (const group of pending.values()) {
    if (Date.now() + 5000 >= deadline) { errors.push("Synchronisation : limite de temps atteinte."); break; }
    const tournamentId = Number(group[0].competition.externalId);
    try {
      let dated: ApiEvent[] = [];
      if (Number.isSafeInteger(tournamentId) && tournamentId > 0 && group.some(match => match.externalId && /^\d+$/.test(match.externalId))) {
        try { dated = await fetchSyncEvents(group[0].scheduledAt.toISOString().slice(0, 10), { deadline, tournamentId }); }
        catch (error) { if (!(error instanceof AllSportsHttpError && error.status === 404)) throw error; }
      }
      const calendar = new Map(dated.map(event => [event.id, event]));
      for (const match of group) {
        if (Date.now() + 2000 >= deadline) { errors.push("Synchronisation : limite de temps atteinte."); break; }
        try {
          let event = calendar.get(Number(match.externalId));
          if (!event && match.externalId && /^\d+$/.test(match.externalId)) event = await fetchMatchEvent(match.externalId, deadline) ?? undefined;
          if (event) await apply(match, event);
          else if (match.status === "SCHEDULED" && match.scheduledAt <= now) await apply(match, null);
          else errors.push(`Match ${match.id} absent des réponses fournisseur.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Lecture du match indisponible.";
          if (/budget|quota|réserve|limite de temps/i.test(message)) throw error;
          errors.push(`${match.id} : ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "AllSportsApi indisponible.";
      errors.push(message);
      if (/budget|quota|réserve|limite de temps/i.test(message)) break;
    }
  }
  return { synced, errors, duration: Date.now() - started };
}

/** One-off repair also handles older dates and matches without an external ID. */
export const syncOrphanMatches = (deadline = Date.now() + 55000) => updateMatches("orphans", deadline);

/** Backfill observations without inventing a final-whistle time or a score. */
export async function backfillMatchTimestamps() {
  return prisma.$executeRaw`UPDATE "Match"
    SET "startedAt" = COALESCE("startedAt", "scheduledAt"),
        "finishedAt" = COALESCE("finishedAt", NOW()), "updatedAt" = NOW()
    WHERE status = 'FINISHED' AND ("startedAt" IS NULL OR "finishedAt" IS NULL)`;
}

export const syncLiveMatches = (deadline = Date.now() + 55000) => updateMatches("live", deadline);
export const syncUpcomingMatches = (deadline = Date.now() + 55000) => updateMatches("upcoming", deadline);
export const syncFinishedMatches = (deadline = Date.now() + 55000) => updateMatches("finished", deadline);

async function run(type: SyncPriority): Promise<SyncResult> {
  // Establish the connection before the short transaction. A sleeping database
  // must not spend the transaction's entire timeout opening its first socket.
  await prisma.$queryRaw`SELECT 1`;
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
    revalidatePath("/live");
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
