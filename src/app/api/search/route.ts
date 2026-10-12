import { NextRequest, NextResponse } from "next/server";
import { searchArticles, SearchValidationError } from "@/lib/search";
import { clientIpFromHeaders, consumeRateLimit, SEARCH_RATE_LIMIT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const state = consumeRateLimit(`search:${clientIpFromHeaders(request.headers)}`, SEARCH_RATE_LIMIT);
  const headers = { "Cache-Control": "no-store", "X-RateLimit-Limit": "30", "X-RateLimit-Remaining": String(state.remaining) };
  if (!state.allowed) return NextResponse.json({ error: "Trop de recherches. Réessayez dans une minute." }, { status: 429, headers: { ...headers, "Retry-After": String(Math.max(1, Math.ceil(state.retryAfterMs / 1000))) } });
  const params = request.nextUrl.searchParams;
  try {
    for (const key of ["q", "format", "category", "theme", "from", "to", "page", "limit"]) {
      if (params.getAll(key).length > 1) throw new SearchValidationError(`Le paramètre ${key} ne doit être fourni qu’une fois.`);
    }
    for (const key of ["page", "limit"]) {
      if (params.has(key) && !/^\d+$/.test(params.get(key)!)) throw new SearchValidationError(`${key} doit être un entier positif.`);
    }
    const results = await searchArticles({
      q: params.get("q") ?? "",
      format: params.get("format") ?? undefined,
      category: params.get("category") ?? undefined,
      theme: params.get("theme") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      page: params.has("page") ? Number(params.get("page")) : undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    });
    return NextResponse.json(results, { headers });
  } catch (error) {
    if (error instanceof SearchValidationError) return NextResponse.json({ error: error.message }, { status: 400, headers });
    console.error("Search API failed", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: "La recherche est temporairement indisponible." }, { status: 500, headers });
  }
}
