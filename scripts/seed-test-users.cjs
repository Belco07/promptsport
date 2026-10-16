/**
 * Seed E2E-1 — comptes de test dédiés pour les parcours Playwright.
 *
 * Crée (ou met à jour) deux comptes dont les identifiants sont partagés avec
 * `tests/fixtures/users.ts` :
 *   - e2e-reader@example.test  (READER)  : commentaires, espace personnel ;
 *   - e2e-editor@example.test  (EDITOR)  : studio, création et publication.
 *
 * Le script est idempotent : relancé, il réinitialise le mot de passe, le rôle
 * et l'état de bienvenue (`welcomeCompleted`), pour que la connexion ne dépende
 * jamais d'un état laissé par un test précédent. Il ne touche à aucune autre
 * ligne de la base.
 *
 * Exécution :
 *   node scripts/seed-test-users.cjs
 *
 * En CI, lancer après `npx prisma migrate deploy` (et, si besoin, `npm run db:seed`).
 */

const { randomBytes } = require("node:crypto");
const bcrypt = require("bcryptjs");

// WP12a : la base est PostgreSQL ; passerelle synchrone du projet.
const Database = require("./lib/pg-sync.cjs");

/** Comptes créés — doivent rester synchronisés avec tests/fixtures/users.ts. */
const TEST_USERS = [
  {
    email: "e2e-reader@example.test",
    name: "Lecteur E2E",
    role: "READER",
    password: "E2eReader-2026!pw",
  },
  {
    email: "e2e-editor@example.test",
    name: "Éditeur E2E",
    role: "EDITOR",
    password: "E2eEditor-2026!pw",
  },
];

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

async function main() {
  const db = new Database();
  console.log("Base : PostgreSQL (DATABASE_URL)");

  for (const user of TEST_USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    const existing = db
      .prepare("SELECT id FROM Author WHERE email = ?")
      .get(user.email);

    if (existing) {
      // Réinitialisation complète : un test peut avoir banni ou redirigé le
      // compte (welcomeCompleted), la connexion doit rester déterministe.
      db.prepare(
        `UPDATE Author
         SET name = ?, passwordHash = ?, role = ?, welcomeCompleted = true,
             bannedUntil = NULL, banReason = NULL
         WHERE email = ?`,
      ).run(user.name, passwordHash, user.role, user.email);
      console.log(`Compte mis a jour : ${user.email} (id ${existing.id})`);
    } else {
      const id = createCuid();
      db.prepare(
        `INSERT INTO Author (id, name, email, passwordHash, role, welcomeCompleted, createdAt)
         VALUES (?, ?, ?, ?, ?, true, CURRENT_TIMESTAMP)`,
      ).run(id, user.name, user.email, passwordHash, user.role);
      console.log(`Compte cree : ${user.email} (id ${id})`);
    }

    const stored = db
      .prepare("SELECT passwordHash FROM Author WHERE email = ?")
      .get(user.email);
    const matches = await bcrypt.compare(user.password, stored.passwordHash);
    if (!matches) {
      throw new Error(
        `Le mot de passe enregistre pour ${user.email} ne correspond pas au hachage.`,
      );
    }
    console.log(`Verification bcrypt.compare : OK pour ${user.email}`);
  }

  db.close();
  console.log("Seed E2E termine : 2 comptes de test disponibles.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
