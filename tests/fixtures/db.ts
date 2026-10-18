import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Accès PostgreSQL pour les tests E2E (E2E-1).
 *
 * Les tests préparent et nettoient leurs données directement en SQL : le client
 * Prisma généré est en TypeScript sans extensions d'import (« ./enums »), ce que
 * le transpileur de Playwright ne charge pas de façon fiable — même raison que
 * les scripts `prisma/seed.cjs` et `scripts/check-*.cjs`, qui écrivent en SQL.
 * `pg` est déjà une dépendance de l'application (adaptateur Prisma), et le
 * schéma Prisma reste la référence : toute fixture porte un identifiant préfixé
 * `e2e-` pour être reconnaissable et supprimable sans ambiguïté.
 *
 * En local, la configuration vient du fichier `.env` (comme pour les scripts de
 * vérification) ; en CI, les variables d'environnement du workflow font foi.
 */

/** Interface minimale du client `pg` — évite d'ajouter `@types/pg` aux dépendances. */
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
};

type PgConstructor = new (config: { connectionString: string }) => PgClient;

/** Charge `.env` si aucune URL n'est déjà fournie par l'environnement. */
function resolveDatabaseUrl(): string {
  if (!process.env.DATABASE_URL?.trim() && !process.env.APP_DATABASE_URL?.trim()) {
    const loadEnvFile = (
      process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }
    ).loadEnvFile;
    try {
      loadEnvFile?.(path.resolve(process.cwd(), ".env"));
    } catch {
      // .env absent (CI) : les variables doivent venir de l'environnement.
    }
  }

  const url = process.env.APP_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL est introuvable : renseignez .env (voir .env.example) ou l'environnement du workflow E2E.",
    );
  }
  const target = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || (target.port && target.port !== "5432")) throw new Error("E2E interdit hors PostgreSQL Docker local : localhost:5432.");
  return url;
}

let client: PgClient | null = null;

/** Exécute une requête SQL et renvoie ses lignes. */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!client) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- pg est en CommonJS et sans types ; on n'ajoute pas @types/pg (voir en-tête).
    const { Client } = require("pg") as { Client: PgConstructor };
    client = new Client({ connectionString: resolveDatabaseUrl() });
    await client.connect();
  }
  const result = await client.query(text, params);
  return result.rows as T[];
}

/** Première ligne d'une requête, ou `null`. */
export async function sqlOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Ferme la connexion du worker Playwright courant.
 *
 * Appelée en fin de suite de chaque fichier de test : sans cela, un worker
 * réutilisé par plusieurs fichiers garde une connexion ouverte.
 */
export async function closeDb(): Promise<void> {
  if (!client) return;
  const current = client;
  client = null;
  await current.end();
}

/** Identifiant de fixture unique, préfixé `e2e-` (reconnaissable et nettoyable). */
export function e2eId(prefix: string): string {
  return `e2e-${prefix}-${randomUUID()}`;
}

/** Adresse e-mail unique pour les parcours inscription et newsletter. */
export function e2eEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
}
