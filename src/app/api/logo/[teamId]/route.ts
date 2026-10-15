import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIpFromHeaders, consumeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const host = "allsportsapi2.p.rapidapi.com";
const day = 86_400_000;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Only known teams may consume the image budget. Never fetch a caller URL. */
export async function GET(request: Request, { params }: { params: Promise<{ teamId: string }> }) {
  const limit = consumeRateLimit(`logo:${clientIpFromHeaders(request.headers)}`, { max: 60, windowMs: 60_000 });
  const noStore = { "Cache-Control": "no-store" };
  if (!limit.allowed) return new NextResponse(null, { status: 429, headers: { ...noStore, "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) } });
  const { teamId } = await params;
  if (!/^[a-zA-Z0-9:-]{1,100}$/.test(teamId)) return new NextResponse(null, { status: 400, headers: noStore });
  const key = process.env.ALLSPORTS_API_KEY?.trim();
  if (!key) return new NextResponse(null, { status: 503, headers: noStore });
  try {
    const team = await prisma.team.findFirst({ where: { OR: [{ id: teamId }, { externalId: teamId }] }, select: { externalId: true } });
    if (!team?.externalId || !/^\d{1,12}$/.test(team.externalId)) return new NextResponse(null, { status: 404, headers: noStore });
    const endpoint = `/api/team/${team.externalId}/image`;
    const keyHash = createHash("sha256").update(key).digest("hex");
    // Durable cache + lock prevent concurrent serverless instances spending twice.
    const image = await prisma.$transaction(async db => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(190021)`;
      const cached = await db.syncLog.findFirst({ where: { type: `logo:${team.externalId}`, status: "SUCCESS", finishedAt: { gt: new Date(Date.now() - day) } }, orderBy: { finishedAt: "desc" } });
      const stored = cached?.errors as { body?: string; contentType?: string } | null;
      if (stored?.body && stored.contentType && imageTypes.has(stored.contentType)) return { body: stored.body, contentType: stored.contentType };
      const where = { type: "request", startedAt: { gt: new Date(Date.now() - day) }, errors: { path: ["keyHash"], equals: keyHash } };
      const used = await db.syncLog.count({ where });
      const logos = await db.syncLog.count({ where: { ...where, AND: [{ errors: { path: ["endpoint"], string_starts_with: "/api/team/" } }] } });
      const last = await db.syncLog.findFirst({ where, orderBy: { startedAt: "desc" } });
      const response = await db.syncLog.findFirst({ where: { ...where, AND: [{ errors: { path: ["remaining"], gte: 0 } }] }, orderBy: { startedAt: "desc" } });
      const quota = response?.errors as { remaining?: number; resetAt?: number } | null;
      if (used >= 80 || logos >= 5 || (quota?.remaining !== undefined && quota.remaining <= 20 && (!quota.resetAt || quota.resetAt > Date.now()))) return null;
      if (last && Date.now() - last.startedAt.getTime() < 250) return null;
      // No retries: an error must never silently consume several paid requests.
      const startedAt = new Date();
      let result: { body: string; contentType: string } | null = null;
      let remaining: number | undefined;
      let resetAt: number | undefined;
      try {
        const upstream = await fetch(`https://${host}${endpoint}`, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
        const remainingHeader = upstream.headers.get("x-ratelimit-requests-remaining");
        const resetHeader = upstream.headers.get("x-ratelimit-requests-reset");
        if (remainingHeader && /^\d+$/.test(remainingHeader)) remaining = Number(remainingHeader);
        if (resetHeader && /^\d+$/.test(resetHeader)) resetAt = Date.now() + Number(resetHeader) * 1000;
        const contentType = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
        if (upstream.ok && contentType && imageTypes.has(contentType)) {
          const reader = upstream.body?.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          if (reader) {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 262144) { await reader.cancel(); break; }
                chunks.push(value);
              }
              if (size > 0 && size <= 262144) result = { body: Buffer.concat(chunks).toString("base64"), contentType };
            } finally { reader.releaseLock(); }
          }
        }
      } catch { /* Record the attempt without exposing credentials or upstream errors. */ }
      await db.syncLog.create({ data: { type: "request", startedAt, finishedAt: new Date(), status: result ? "SUCCESS" : "FAILED", errors: { keyHash, endpoint, ...(remaining !== undefined ? { remaining } : {}), ...(resetAt !== undefined ? { resetAt } : {}) } } });
      if (result) await db.syncLog.create({ data: { type: `logo:${team.externalId}`, finishedAt: new Date(), status: "SUCCESS", errors: result } });
      return result;
    }, { timeout: 15000, maxWait: 3000 });
    if (!image) return new NextResponse(null, { status: 503, headers: { ...noStore, "Retry-After": "3600" } });
    return new NextResponse(Buffer.from(image.body, "base64"), { headers: { "Content-Type": image.contentType, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch { return new NextResponse(null, { status: 503, headers: noStore }); }
}
