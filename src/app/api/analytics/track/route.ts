import {
  VISITOR_COOKIE,
  categorizeSource,
  detectCountry,
  detectDevice,
  isBotUserAgent,
  isTrackablePath,
  isValidVisitorId,
  normalizePath,
  parseReferrerHost,
  readCookie,
  trackPageView,
} from "@/lib/analytics";
import { auth } from "@/lib/auth";

/**
 * Route de collecte analytics (WP8d).
 *
 * Reçoit le beacon du navigateur, filtre robots et chemins privés, enregistre
 * la page vue, et répond 204 sans charge utile. Aucune donnée personnelle :
 * l'identifiant vient du cookie anonyme `ps_vid`, l'agent utilisateur est
 * tronqué, et le pays provient au mieux d'un en-tête d'hébergeur.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Réponse vide : le beacon n'attend aucun contenu. */
function noContent(): Response {
  return new Response(null, { status: 204 });
}

export async function POST(request: Request): Promise<Response> {
  // 1) Visiteur identifié par son cookie first-party (sinon rien à enregistrer).
  const visitorId = readCookie(request.headers.get("cookie"), VISITOR_COOKIE);
  if (!isValidVisitorId(visitorId)) {
    return noContent();
  }

  // 2) Robots et outils en ligne de commande exclus.
  const userAgent = request.headers.get("user-agent");
  if (isBotUserAgent(userAgent)) {
    return noContent();
  }

  // 3) Charge utile minimale : chemin, référent, écran (l'écran n'est pas stocké).
  let payload: { path?: unknown; referrer?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return noContent();
  }

  const path = typeof payload.path === "string" ? normalizePath(payload.path) : "";
  if (!isTrackablePath(path)) {
    return noContent();
  }

  const referrer = parseReferrerHost(
    typeof payload.referrer === "string" ? payload.referrer : null,
    request.headers.get("host"),
  );

  // 4) Rattachement éventuel à un compte connecté (aucun autre usage).
  const session = await auth();

  await trackPageView({
    visitorId,
    path,
    referrer,
    source: categorizeSource(referrer),
    userAgent: userAgent ?? null,
    country: detectCountry(request.headers),
    device: detectDevice(userAgent ?? null),
    userId: session?.user?.id ?? null,
  });

  return noContent();
}

/** Les autres méthodes (dont HEAD) ne créent aucune donnée. */
export function GET(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function HEAD(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
