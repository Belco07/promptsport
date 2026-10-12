import { defineConfig, env } from "prisma/config";

/**
 * Configuration de la CLI Prisma (Prisma 7).
 *
 * Depuis la v7, l'URL de connexion ne peut plus vivre dans schema.prisma :
 * elle est déclarée ici pour les commandes de migration, et passée au client
 * via un driver adapter (voir src/lib/prisma.ts).
 *
 * Prisma Postgres fournit **deux** chaînes de connexion :
 *   - `DATABASE_URL` : chaîne *pooled* (`pooled.db.prisma.io`), pour
 *     l'application : les fonctions serverless ouvrent beaucoup de connexions
 *     courtes, que le pooler multiplexe ;
 *   - `DIRECT_URL`   : chaîne *directe* (`db.prisma.io`), **obligatoire** pour
 *     les migrations, l'introspection et Prisma Studio : un pooler en mode
 *     transaction ne conserve pas l'état de session (verrous, `SET`, requêtes
 *     préparées), d'où des échecs de migration difficiles à lire.
 *
 * La CLI prend donc `DIRECT_URL` en priorité et retombe sur `DATABASE_URL`
 * quand elle n'est pas définie (poste local, CI, ou Vercel où seule
 * `DATABASE_URL` est déclarée) : c'est la configuration recommandée par Prisma
 * (https://docs.prisma.io/docs/postgres/database/connecting-to-your-database).
 * Conséquence pratique : `npm run db:deploy` et `npm run db:seed:themes`
 * fonctionnent sans avoir à réécrire `DATABASE_URL` à la main.
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
