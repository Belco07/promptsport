/**
 * Complète le slug des auteurs existants (WP9).
 *
 * La migration add_author_slug ajoute une colonne nullable : les auteurs créés
 * avant le WP9 doivent recevoir un identifiant d'URL pour que leur page
 * /auteur/[slug] soit accessible. Le slug est dérivé du nom (accents dépliés,
 * caractères non alphanumériques remplacés par des tirets) et rendu unique par
 * suffixe -2, -3… en cas de collision.
 *
 * Idempotent : les auteurs qui ont déjà un slug sont ignorés.
 */
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const path = require("node:path");
const { readFileSync } = require("node:fs");

const url = readFileSync(".env", "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)[1];
const db = new Database();

/** « Chloé Martin » → « chloe-martin ». */
function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const authors = db.prepare("SELECT id, name, slug FROM Author ORDER BY createdAt").all();
const taken = new Set(authors.map((author) => author.slug).filter(Boolean));
const update = db.prepare("UPDATE Author SET slug = ? WHERE id = ?");

let updated = 0;
for (const author of authors) {
  if (author.slug) continue;

  const base = slugify(author.name) || `auteur-${author.id.slice(-6).toLowerCase()}`;
  let candidate = base;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  update.run(candidate, author.id);
  taken.add(candidate);
  updated += 1;
  console.log(`  ${author.name} -> ${candidate}`);
}

console.log(`${updated} auteur(s) complété(s) sur ${authors.length}.`);
