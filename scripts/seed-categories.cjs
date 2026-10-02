const path = require("node:path");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const { readFileSync } = require("node:fs");
function dbFile() {
  let url = process.env.DATABASE_URL;
  if (!url) { const c = readFileSync(path.resolve(".env"), "utf8"); const m = c.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m); url = m ? m[1] : null; }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}
const cats = [["Football","football"],["Tennis","tennis"],["Rugby","rugby"],["Basket","basket"]];
const db = new Database();
let created = 0;
for (const [name, slug] of cats) {
  const existing = db.prepare("SELECT id FROM Category WHERE slug = ?").get(slug);
  if (existing) { console.log("deja presente:", name, existing.id); continue; }
  const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  db.prepare("INSERT INTO Category (id, name, slug, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run(id, name, slug);
  console.log("creee:", name, id);
  created++;
}
console.log("--- categories en base ---");
for (const row of db.prepare("SELECT id, name, slug FROM Category ORDER BY name").all()) console.log(" ", row.name, "|", row.slug, "|", row.id);
console.log("total creees:", created);
db.close();
