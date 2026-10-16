import { timingSafeEqual } from "node:crypto";
import { sendClubDigests } from "@/lib/club-digest";
import { isEmailConfigured } from "@/lib/resend";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ ok: false, error: "Cron non configuré." }, { status: 503 });
  const expected = Buffer.from("Bearer " + secret), received = Buffer.from(request.headers.get("authorization") ?? "");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return Response.json({ ok: false }, { status: 401 });
  try {
    if (new URL(request.url).searchParams.get("check") === "1") return Response.json({ ok: isEmailConfigured(), configured: isEmailConfigured(), ...await sendClubDigests() }, { headers: { "Cache-Control": "no-store" } });
    const result = await sendClubDigests({ send: true, limit: 10 });
    return Response.json({ ok: result.failed === 0, ...result }, { status: result.failed ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ ok: false, error: "Envoi indisponible." }, { status: 503 }); }
}
