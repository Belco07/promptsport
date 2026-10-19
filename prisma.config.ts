import { defineConfig, env } from "prisma/config";

/**
 * Configuration de la CLI Prisma (Prisma 7).
 *
 * Depuis la v7, l'URL de connexion ne peut plus vivre dans schema.prisma :
 * elle est déclarée ici pour les commandes de migration, et passée au client
 * via un driver adapter (voir src/lib/prisma.ts).
 *
 * Neon fournit deux chaînes PostgreSQL :
 *   - DATABASE_URL : hôte pooled `ep-...-pooler....neon.tech` pour PrismaNeon ;
 *   - DIRECT_URL : hôte direct `ep-....neon.tech` pour les migrations,
 *     l'introspection et Prisma Studio (connexion TCP).
 *
 * DIRECT_URL reste prioritaire. Le repli DATABASE_URL est conservé pour les
 * outils locaux/CI qui ne fournissent qu'une URL PostgreSQL directe.
 * APP_DATABASE_URL ne modifie jamais la destination de la CLI.
 *
 * Le fichier .env est lu avec le lecteur natif de Node (process.loadEnvFile),
 * disponible depuis Node 20.12/21.7 — cela évite d'ajouter la dépendance dotenv,
 * conformément au périmètre du WP2a. Une variable déjà présente dans
 * l'environnement du shell n'est pas écrasée par le fichier.
 */
try {
  process.loadEnvFile();
} catch {
  // .env absent : les variables peuvent venir de l'environnement du shell.
}

/** Chaîne directe si elle est renseignée (chaîne vide ou espaces = absente). */
const directUrl = process.env.DIRECT_URL?.trim();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // `env()` n'est évalué que si DIRECT_URL est absente : sans elle, le
    // comportement d'origine — et son message d'erreur explicite — est conservé.
    url: directUrl ? directUrl : env("DATABASE_URL"),
  },
});
