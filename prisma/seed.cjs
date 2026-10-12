/**
 * Seed WP2b — crée l'auteur administrateur de test.
 *
 * Exécution : npm run db:seed
 *
 * Pourquoi SQL direct plutôt que le client Prisma généré :
 * Prisma 7 génère le client en TypeScript avec des imports sans extension
 * (« ./enums »). Turbopack les résout, mais Node — qui exécute ce script —
 * exige des extensions explicites. Charger le client généré demanderait un
 * outil supplémentaire (tsx), hors périmètre du WP2b. On écrit donc en SQL via
 * la passerelle synchrone PostgreSQL du projet (scripts/lib/pg-sync.cjs), qui
 * accepte exactement les mêmes requêtes.
 *
 * WP12a : la base est PostgreSQL (elle était SQLite au WP2b).
 */
const { randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("../scripts/lib/pg-sync.cjs");

const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin123";
const ADMIN_NAME = "Admin Test";
const ADMIN_ROLE = "ADMIN";

/** Identifiant au format cuid v1, celui que Prisma utilise par défaut. */
function createCuid() {
  const timestamp = Date.now().toString(36);
  const counter = Math.floor(Math.random() * 1_679_616)
    .toString(36)
    .padStart(4, "0");
  const fingerprint = randomBytes(2).toString("hex").slice(0, 4);
  const random = randomBytes(4).toString("hex").slice(0, 8);
  return `c${timestamp}${counter}${fingerprint}${random}`;
}

/**
 * Thèmes éditoriaux par défaut : liste partagée avec `prisma/seed-themes.cjs`
 * (production, thèmes uniquement) pour éviter toute divergence. `src/lib/themes.ts`
 * ne porte que les helpers d'affichage (badge, icône).
 */
const DEFAULT_THEMES = require("./default-themes.cjs");

async function main() {
  const db = new Database();
  console.log("Base : PostgreSQL (DATABASE_URL)");

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const existing = db
    .prepare("SELECT id, name FROM Author WHERE email = ?")
    .get(ADMIN_EMAIL);

  if (existing) {
    db.prepare("UPDATE Author SET name = ?, passwordHash = ?, role = ? WHERE email = ?").run(
      ADMIN_NAME,
      passwordHash,
      ADMIN_ROLE,
      ADMIN_EMAIL,
    );
    console.log(`Auteur mis a jour : ${ADMIN_EMAIL} (id ${existing.id})`);
  } else {
    const id = createCuid();
    db.prepare(
      `INSERT INTO Author (id, name, email, passwordHash, role, bio, photoUrl, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)`,
    ).run(
      id,
      ADMIN_NAME,
      ADMIN_EMAIL,
      passwordHash,
      ADMIN_ROLE,
      "Auteur de test créé par le seed du WP2b.",
    );
    console.log(`Auteur cree : ${ADMIN_EMAIL} (id ${id})`);
  }

  // Contrôle : le mot de passe saisi en clair doit correspondre au hachage stocké.
  const stored = db
    .prepare(
      "SELECT name, email, passwordHash FROM Author WHERE email = ?",
    )
    .get(ADMIN_EMAIL);
  const matches = await bcrypt.compare(ADMIN_PASSWORD, stored.passwordHash);
  console.log(`Verification bcrypt.compare("${ADMIN_PASSWORD}") : ${matches}`);
  console.log(`Nom enregistre : ${stored.name}`);

  const total = db.prepare("SELECT count(*) AS n FROM Author").get();
  console.log(`Total auteurs en base : ${total.n}`);

  // ------------------------------------------------------------------ WP16a
  // Thèmes éditoriaux par défaut : transversaux aux sports, distincts des
  // catégories (« Football », « Rugby »…). Le seed est idempotent : le slug sert
  // de clé, relancer `npm run db:seed` met à jour sans créer de doublon.
  //
  // WP20 : `active` fait partie des champs mis à jour — désactiver un thème dans
  // le seed doit se propager à une base existante, pas seulement à la création.
  for (const theme of DEFAULT_THEMES) {
    const existingTheme = db.prepare("SELECT id FROM Theme WHERE slug = ?").get(theme.slug);
    if (existingTheme) {
      db.prepare(
        `UPDATE Theme SET name = ?, description = ?, color = ?, icon = ?, active = ?, "updatedAt" = CURRENT_TIMESTAMP
         WHERE slug = ?`,
      ).run(
        theme.name,
        theme.description,
        theme.color,
        theme.icon,
        theme.active ? 1 : 0,
        theme.slug,
      );
      console.log(`Theme mis a jour : ${theme.slug}${theme.active ? "" : " (desactive)"}`);
    } else {
      db.prepare(
        `INSERT INTO Theme (id, name, slug, description, color, icon, active, "createdAt", "updatedAt")
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(
        createCuid(),
        theme.name,
        theme.slug,
        theme.description,
        theme.color,
        theme.icon,
        theme.active ? 1 : 0,
      );
      console.log(`Theme cree : ${theme.slug}${theme.active ? "" : " (desactive)"}`);
    }
  }
  const themeTotal = db.prepare("SELECT count(*) AS n FROM Theme").get();
  const themeActive = db.prepare("SELECT count(*) AS n FROM Theme WHERE active = true").get();
  console.log(`Total themes en base : ${themeTotal.n} (actifs : ${themeActive.n})`);

  db.close();

  if (!matches) {
    throw new Error("Le mot de passe enregistre ne correspond pas au hachage.");
  }
  console.log("Seed termine.");
}

main().catch((error) => {
  console.error("ECHEC du seed : " + error.message);
  process.exit(1);
});
