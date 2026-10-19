import { PrismaClient } from "@/generated/prisma/client";

/**
 * Singleton Prisma pour Next.js.
 *
 * En développement, le rechargement à chaud réévalue les modules : sans ce
 * cache global, chaque rechargement ouvrirait une nouvelle connexion à
 * PostgreSQL jusqu'à épuisement du pool. En production, une seule instance est
 * créée.
 *
 * WP35 : l'application utilise PrismaNeon (WebSocket) et l'URL pooled Neon.
 * La CLI et les migrations gardent leur URL directe dans prisma.config.ts.
 * Un proxy WebSocket de boucle locale permet de conserver les tests Docker.
 *
 * Prisma 7 ne lit plus .env tout seul : Next.js le charge pour l'application,
 * et on complète le cas échéant avec le lecteur natif de Node (sans dépendance
 * supplémentaire).
 */
function resolveDatabaseUrl(): string {
  // The application can override a DATABASE_URL managed by an integration.
  // Migration commands keep their separate DIRECT_URL configuration.
  const fromEnv = process.env.APP_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  // Repli hors Next.js (script, test) : chargement du .env par Node lui-même.
  const loadEnvFile = (
    process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }
  ).loadEnvFile;
  if (typeof loadEnvFile === "function") {
    try {
      loadEnvFile();
    } catch {
      // .env absent : on laisse le message d'erreur ci-dessous parler.
    }
  }

  const loaded = process.env.APP_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!loaded) {
    throw new Error(
      "APP_DATABASE_URL et DATABASE_URL sont introuvables. Créez un fichier .env à partir de .env.example (URL PostgreSQL).",
    );
  }
  return loaded;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Keep the driver server-side when client components reference Server Actions.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy server-only driver
  const { PrismaNeon } = require("@prisma/adapter-neon") as typeof import("@prisma/adapter-neon");
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- same lazy boundary
  const { neonConfig } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
  const connectionString = resolveDatabaseUrl();
  const localProxy = process.env.NEON_WS_PROXY?.trim();
  if (localProxy) {
    const proxyUrl = new URL(`ws://${localProxy}`);
    const databaseUrl = new URL(connectionString);
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (!loopback.has(proxyUrl.hostname) || !loopback.has(databaseUrl.hostname) || proxyUrl.username || proxyUrl.password) {
      throw new Error("NEON_WS_PROXY est réservé à PostgreSQL et à une passerelle de boucle locale.");
    }
    // Insecure WebSocket is allowed only for the explicit loopback test proxy.
    neonConfig.wsProxy = () => localProxy;
    neonConfig.useSecureWebSocket = false;
    neonConfig.pipelineTLS = false;
    neonConfig.pipelineConnect = false;
    neonConfig.poolQueryViaFetch = false;
  }
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
