import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getLastSportsUpdate } from "@/lib/live-sync";

export const dynamic = "force-dynamic";
const getStatus = unstable_cache(async () => {
  const [lastSync, liveCount] = await Promise.all([getLastSportsUpdate(), prisma.match.count({ where: { status: "LIVE" } })]);
  return { lastSync: lastSync?.finishedAt?.toISOString() ?? null, hasLive: liveCount > 0, liveCount };
}, ["sports-sync-status"], { revalidate: 15 });

export async function GET() {
  try {
    return NextResponse.json(await getStatus(), { headers: { "Cache-Control": "public, max-age=0, s-maxage=15" } });
  } catch {
    return NextResponse.json({ error: "Statut de synchronisation indisponible." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
