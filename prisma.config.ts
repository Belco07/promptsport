import { defineConfig, env } from "prisma/config";

/**
 * Configuration de la CLI Prisma (Prisma 7).
 *
 * Depuis la v7, l'URL de connexion ne peut plus vivre dans schema.prisma :
 * elle est déclarée ici pour les commandes de migration, et passée au client
 * via un driver adapter (voir src/lib/prisma.ts).
 *
 * Le fichier .env est lu avec le lecteur natif de Node (process.loadEnvFile),
 * disponible depuis Node 20.12/21.7 — cela évite d'ajouter la dépendance dotenv,
 * conformément au périmètre du WP2a.
 */
try {
  process.loadEnvFile();
} catch {
  // .env absent : les variables peuvent venir de l'environnement du shell.
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
