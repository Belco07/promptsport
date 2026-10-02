import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { processScheduledCampaigns } from "@/lib/newsletter-send";

/**
 * Envoi des campagnes planifiées (WP11d).
 *
 * Appelé par un cron (Vercel Cron, GitHub Actions, cron système) — la
 * configuration est décrite dans le README. Deux points de sécurité :
 *
 *  - le jeton `CRON_SECRET` est comparé en temps constant (`timingSafeEqual`) :
 *    une comparaison naïve laisserait fuiter le secret par le temps de réponse ;
 *  - sans secret configuré, l'endpoint répond 503 plutôt que de laisser
 *    n'importe qui déclencher des envois.
 *
 * GET comme POST sont acceptés : la plupart des ordonnanceurs appellent en GET,
 * les webhooks de CI en POST.
 */

/** Comparaison à durée constante de deux chaînes. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** Jeton présenté par l'appelant : en-tête `Authorization` ou paramètre `token`. */
function providedToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const url = new URL(request.url);
  return url.searchParams.get("token");
}

async function handle(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("[cron/newsletter] CRON_SECRET absente : déclenchement refusé.");
    return NextResponse.json({ error: "Cron non configuré." }, { status: 503 });
  }

  const token = providedToken(request);
  if (!token || !safeEqual(token, secret)) {
    return NextResponse.json({ error: "Jeton invalide." }, { status: 401 });
  }

  try {
    const run = await processScheduledCampaigns();
    return NextResponse.json({
      ok: true,
      processed: run.processed,
      errors: run.errors,
    });
  } catch (error) {
    console.error(
      "[cron/newsletter] échec du traitement :",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ error: "Traitement interrompu." }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
