import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ success: false, error: "Cron non configuré." }, { status: 503, headers: HEADERS });

  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1].trim();
  const expected = Buffer.from(secret);
  const supplied = Buffer.from(token ?? "");
  if (!token || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return NextResponse.json({ success: false, error: "Jeton invalide." }, { status: 401, headers: HEADERS });
  }

  try {
    // Importer après l'authentification : une requête refusée ne touche pas la base.
    const { fetchNews } = await import("@/lib/news-fetcher");
    const result = await fetchNews({ concurrency: 3 });
    if (result.sourcesProcessed > 0 && result.sourcesFailed === result.sourcesProcessed) {
      return NextResponse.json({ success: false, error: "Aucune source n’a pu être collectée." }, { status: 502, headers: HEADERS });
    }
    return NextResponse.json({ success: true, alertsCreated: result.alertsCreated }, { headers: HEADERS });
  } catch {
    console.error("[cron/fetch-news] Collecte interrompue.");
    return NextResponse.json({ success: false, error: "Collecte indisponible." }, { status: 500, headers: HEADERS });
  }
}
