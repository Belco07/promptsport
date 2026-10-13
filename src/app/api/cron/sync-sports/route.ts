import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { synchronizeSports, type SyncPriority } from "@/lib/live-sync";
import { syncEligibleMatchDetails, type MatchDetailPart } from "@/lib/allsports-sync";
import { revalidatePath } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Cron non configuré." }, { status: 503 });
  const url = new URL(request.url);
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1].trim() ?? url.searchParams.get("token") ?? "";
  const left = Buffer.from(token), right = Buffer.from(secret);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return NextResponse.json({ error: "Jeton invalide." }, { status: 401 });
  const priority = url.searchParams.get("priority") ?? "live";
  if (!["live", "upcoming", "finished"].includes(priority)) return NextResponse.json({ error: "Priorité invalide." }, { status: 400 });
  const include = (url.searchParams.get("include") ?? (priority === "finished" ? "events,stats,lineups" : priority === "live" ? "events" : "")).split(",").filter(Boolean);
  if (include.some(part => !["events", "stats", "lineups"].includes(part))) return NextResponse.json({ error: "Détails invalides." }, { status: 400 });
  const deadline = Date.now() + 55000;
  try {
    const result = await synchronizeSports(priority as SyncPriority);
    const details = include.length && Date.now() + 5000 < deadline ? await syncEligibleMatchDetails(include as MatchDetailPart[], deadline) : { synced: 0, errors: [] };
    if (details.synced) revalidatePath("/match/[id]", "page");
    return NextResponse.json({ ok: !result.errors.length && !details.errors.length, ...result, details }, { status: result.errors.length && !result.synced ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Journal de synchronisation indisponible." }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
