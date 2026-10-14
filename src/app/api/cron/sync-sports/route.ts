import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { synchronizeSports, type SyncPriority } from "@/lib/live-sync";
import { syncEligibleMatchDetails, syncChampionsLeagueStandings, type MatchDetailPart } from "@/lib/allsports-sync";
import { prisma } from "@/lib/prisma";
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
  const headers = { "Cache-Control": "no-store" };
  // Check the deployed environment even when no fixture needs an API call.
  if (!process.env.ALLSPORTS_API_KEY?.trim()) {
    return NextResponse.json({ ok: false, error: "ALLSPORTS_API_KEY absente de ce déploiement de production.", code: "MISSING_API_KEY" }, { status: 503, headers });
  }
  if (url.searchParams.get("check") === "1") {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return NextResponse.json({ ok: true, configuration: "Présente", database: "Accessible", providerRequests: 0 }, { headers });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DATABASE_UNAVAILABLE";
      console.error("[sports-sync] Database check failed", { code });
      return NextResponse.json({ ok: false, error: "Connexion à la base de données indisponible.", code }, { status: 503, headers });
    }
  }
  const priority = url.searchParams.get("priority") ?? "live";
  if (!["live", "upcoming", "finished"].includes(priority)) return NextResponse.json({ error: "Priorité invalide." }, { status: 400 });
  const include = (url.searchParams.get("include") ?? (priority === "finished" ? "events,stats,lineups" : priority === "live" ? "events" : "")).split(",").filter(Boolean);
  if (include.some(part => !["events", "stats", "lineups"].includes(part))) return NextResponse.json({ error: "Détails invalides." }, { status: 400 });
  const deadline = Date.now() + 55000;
  try {
    const result = await synchronizeSports(priority as SyncPriority);
    // One standings snapshot per day; never fetch it from a public page.
    if (priority === "finished" && Date.now()+10000 < deadline) {
      const seed = await prisma.syncLog.findFirst({where:{type:"standings:7",status:"SUCCESS"},orderBy:{finishedAt:"desc"}});
      if (seed) {
        const metadata = seed.errors as {seasonId?:number;seasonLabel?:string};
        const competition = await prisma.competition.findUnique({where:{externalId:"7"},select:{season:true}});
        if (Number.isSafeInteger(metadata.seasonId) && metadata.seasonLabel===competition?.season) {
          try { const standings=await syncChampionsLeagueStandings(metadata.seasonId!,metadata.seasonLabel!,deadline); if(standings.synced)revalidatePath("/competition/uefa-champions-league"); }
          catch(error) { result.errors.push(error instanceof Error?error.message:"Classement indisponible."); }
        }
      }
    }
    const details = include.length && Date.now() + 5000 < deadline ? await syncEligibleMatchDetails(include as MatchDetailPart[], deadline) : { synced: 0, errors: [] };
    if (details.synced) revalidatePath("/match/[id]", "page");
    return NextResponse.json({ ok: !result.errors.length && !details.errors.length, ...result, details }, { status: result.errors.length && !result.synced ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "SYNC_UNAVAILABLE";
    console.error("[sports-sync] Synchronization failed", { code });
    return NextResponse.json({ ok: false, error: "Synchronisation indisponible : vérifier la connexion à la base et les journaux Vercel.", code }, { status: 503, headers });
  }
}

export const GET = handle;
export const POST = handle;
