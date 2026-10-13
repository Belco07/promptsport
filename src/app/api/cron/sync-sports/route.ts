import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { synchronizeSports, type SyncPriority } from "@/lib/live-sync";

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
  try {
    const result = await synchronizeSports(priority as SyncPriority);
    return NextResponse.json({ ok: !result.errors.length, ...result }, { status: result.errors.length && !result.synced ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Journal de synchronisation indisponible." }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
