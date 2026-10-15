import { clientIpFromHeaders, consumeRateLimit, SYNC_STATUS_RATE_LIMIT } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getLastSportsUpdate } from "@/lib/live-sync";

export const dynamic = "force-dynamic";
const getStatus = unstable_cache(async () => {
  const [lastSync, liveCount] = await Promise.all([getLastSportsUpdate(), prisma.match.count({ where: { status: "LIVE" } })]);
  return { lastSync: lastSync?.finishedAt?.toISOString() ?? null, hasLive: liveCount > 0, liveCount };
}, ["sports-sync-status"], { revalidate: 15 });

export async function GET(request: Request) {
  const limit = consumeRateLimit(`sync-status:${clientIpFromHeaders(request.headers)}`, SYNC_STATUS_RATE_LIMIT);
  if (!limit.allowed) return NextResponse.json({ error: "Trop de requêtes." }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) } });
  try {
    return NextResponse.json(await getStatus(), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Statut de synchronisation indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
