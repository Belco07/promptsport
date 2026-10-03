import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

/**
 * Middleware : protection par rôle des routes /studio/* et /backoffice/*, et
 * pose du cookie visiteur anonyme `ps_vid` (WP8d).
 *
 * Le middleware s'exécute sur le runtime Edge : il n'importe pas src/lib/auth.ts
 * (qui embarque bcryptjs et Prisma, incompatibles Edge) ni src/lib/analytics.ts
 * (qui importe Prisma). Il lit le JWT signé via getToken et vérifie le rôle.
 *
 * Règles :
 *  - /backoffice/* : ADMIN uniquement, sinon redirection vers /studio.
 *  - /studio/*     : ADMIN, EDITOR ou JOURNALIST, sinon redirection vers /login.
 *  - /login        : publique (avec le cookie visiteur).
 */

/* Cookie visiteur — constantes dupliquées depuis src/lib/analytics.ts, qui
 * n'est pas importable ici (Prisma). Toute évolution doit être répercutée. */
const VISITOR_COOKIE = "ps_vid";
const VISITOR_COOKIE_MAX_AGE = 2_592_000; // 30 jours
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Valeur du cookie visiteur, si elle a été émise par nous. */
function readVisitorId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === VISITOR_COOKIE) {
      const value = decodeURIComponent(part.slice(index + 1).trim());
      return UUID_V4.test(value) ? value : null;
    }
  }
  return null;
}

export default async function middleware(request: Request) {
  const { pathname } = new URL(request.url);

  const token = await getToken({
    req: request as Parameters<typeof getToken>[0]["req"],
    secret: process.env.AUTH_SECRET,
    secureCookie: process.env.NODE_ENV === "production",
  });

  const role = typeof token?.role === "string" ? token.role : null;

  let response: NextResponse;

  if (pathname.startsWith("/backoffice")) {
    if (role !== "ADMIN") {
      // Non-admin : s'il est connecté, on l'envoie vers le studio ; sinon vers la connexion.
      const target = token ? "/studio" : "/login";
      response = NextResponse.redirect(new URL(target, request.url));
    } else {
      response = NextResponse.next();
    }
  } else if (pathname.startsWith("/studio")) {
    if (!token || !["ADMIN", "EDITOR", "JOURNALIST"].includes(role ?? "")) {
      response = NextResponse.redirect(new URL("/login", request.url));
    } else {
      response = NextResponse.next();
    }
  } else {
    response = NextResponse.next();
  }

  // Cookie visiteur anonyme : posé à la première visite, conservé 30 jours.
  // Aucune PII, aucun fingerprinting, aucun cookie tiers.
  const existingVisitor = readVisitorId(request.headers.get("cookie"));
  if (!existingVisitor) {
    response.cookies.set(VISITOR_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VISITOR_COOKIE_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  /* Toutes les pages (publiques et protégées) : le cookie visiteur doit être
   * posé dès la première visite, quelle que soit la porte d'entrée. Sont
   * exclus l'API, les fichiers de /_next, les métadonnées et tout fichier
   * statique (chemin contenant un point).
   *
   * Emplacement du fichier : obligatoirement src/middleware.ts, au même niveau
   * que le dossier app/ — un middleware.ts à la racine du projet est ignoré
   * (constat de test : il n'était jamais exécuté). */
  matcher: [
    "/((?!api|_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|rss.xml|manifest.webmanifest|.*\\..*).*)",
  ],
};
