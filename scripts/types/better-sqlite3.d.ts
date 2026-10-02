/**
 * Déclaration de types minimale pour `better-sqlite3`.
 *
 * WP12a : le paquet n'est plus une dépendance d'exécution du site (la base est
 * PostgreSQL). Il ne sert plus qu'au script de migration
 * `scripts/migrate-sqlite-to-postgres.ts`, qui relit la base SQLite d'origine.
 * Aucun paquet `@types/better-sqlite3` n'est installé : cette déclaration couvre
 * exactement l'usage du script de migration, sans ajouter de dépendance.
 */
declare module "better-sqlite3" {
  export interface BetterSqlite3Statement {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  }

  export default class Database {
    constructor(filename: string, options?: { readonly?: boolean; fileMustExist?: boolean });
    prepare(sql: string): BetterSqlite3Statement;
    exec(sql: string): void;
    close(): void;
  }
}
