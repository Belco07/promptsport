import { PrismaClient } from "@/generated/prisma/client";

/**
 * Singleton Prisma pour Next.js.
 *
 * En développement, le rechargement à chaud réévalue les modules : sans ce
 * cache global, chaque rechargement ouvrirait une nouvelle connexion à
 * PostgreSQL jusqu'à épuisement du pool. En production, une seule instance est
 * créée.
 *
 * WP12a : la source de données est passée de SQLite à PostgreSQL. L'adaptateur
 * `@prisma/adapter-better-sqlite3` est spécifique à SQLite : il est remplacé par
 * `@prisma/adapter-pg`, qui parle le protocole PostgreSQL (c'est l'exception
 * prévue par le brief du WP12a — sans ce changement, le client ne peut pas se
 * connecter).
 *
 * Prisma 7 ne lit plus .env tout seul : Next.js le charge pour l'application,
 * et on complète le cas échéant avec le lecteur natif de Node (sans dépendance
 * supplémentaire).
 */
function resolveDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
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

  const loaded = process.env.DATABASE_URL;
  if (!loaded) {
    throw new Error(
      "DATABASE_URL est introuvable. Créez un fichier .env à partir de .env.example (URL PostgreSQL).",
    );
  }
  return loaded;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // L'adaptateur est chargé paresseusement : `@prisma/adapter-pg` importe `pg`,
  // qui n'a de sens que dans le runtime serveur. Un import statique le fait
  // évaluer dans toutes les couches du bundle, y compris celles qui chargent les
  // modules de Server Actions référencés par un composant client — l'évaluation
  // échoue alors et TOUTES les Server Actions de la page répondent 500
  // (« Cannot read properties of undefined (reading 'bind') »).
  // En le chargeant ici, il n'est évalué qu'à la création réelle du client.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- chargement paresseux assumé (voir commentaire ci-dessus)
  const { PrismaPg } = require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
  const adapter = new PrismaPg({ connectionString: resolveDatabaseUrl() });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
