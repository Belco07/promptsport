/**
 * Vérification du WP6c — pages publiques sportives.
 * Crée 6 matchs Ligue 1 terminés (scores connus) pour tester le classement,
 * vérifie les pages, puis supprime les données de test.
 */
const http = require("node:http");
const path = require("node:path");
const { readFileSync } = require("node:fs");
// WP12a : la base est PostgreSQL ; passerelle synchrone scripts/lib/pg-sync.cjs
const Database = require("./lib/pg-sync.cjs");
const crypto = require("node:crypto");

const HOST = "localhost";
const PORT = Number(process.env.PORT || 3000);

function dbPath() {
  let url = process.env.DATABASE_URL;
  if (!url) {
    const c = readFileSync(path.resolve(".env"), "utf8");
    const m = c.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    url = m ? m[1] : null;
  }
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
}

const results = [];
function check(label, ok, detail) {
  results.push(ok);
  console.log(`${ok ? "OK   " : "ECHEC"} | ${label}${detail ? " -> " + detail : ""}`);
}

function cuid() {
  return "c" + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0") + crypto.randomBytes(2).toString("hex").slice(0, 4) + crypto.randomBytes(4).toString("hex").slice(0, 8);
}

async function main() {
  const db = new Database(dbPath());

  /* Jeu de données du contrôle.
   *
   * WP12a : la base de développement ne contient plus la Ligue 1 française
   * (elle a été synchronisée avec la Premier League via football-data.org), et
   * cette suite se contentait de *lire* la compétition et les équipes. Elle crée
   * donc désormais ce qui manque et ne supprime à la fin que ce qu'elle a créé —
   * elle reste ainsi reproductible sur n'importe quelle base. */
  let ligue1 = db.prepare("SELECT id, slug FROM Competition WHERE slug='french-ligue-1'").get();
  const createdCompetitionId = ligue1 ? null : cuid();
  if (!ligue1) {
    db.prepare(
      `INSERT INTO Competition (id, name, slug, country, sport, externalId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(createdCompetitionId, "Ligue 1", "french-ligue-1", "France", "football", "fl1-test");
    ligue1 = { id: createdCompetitionId, slug: "french-ligue-1" };
  }

  const createdTeamIds = [];
  const teamByExt = (ext, name, slug) => {
    const existing = db.prepare("SELECT id, name FROM Team WHERE externalId=?").get(ext);
    if (existing) return existing;
    const id = cuid();
    db.prepare(
      `INSERT INTO Team (id, name, slug, shortName, country, sport, externalId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'football', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(id, name, slug, name, "France", ext);
    createdTeamIds.push(id);
    return { id, name };
  };

  const psg = teamByExt("133714", "Paris Saint-Germain", "psg-test"),
    marseille = teamByExt("133707", "Marseille", "marseille-test"),
    angers = teamByExt("134709", "Angers", "angers-test"),
    lens = teamByExt("133822", "Lens", "lens-test"),
    lyon = teamByExt("133713", "Lyon", "lyon-test"),
    lille = teamByExt("133711", "Lille", "lille-test");

  check(
    "Ligue 1 et équipes de test trouvées",
    Boolean(ligue1 && psg && marseille && angers && lens && lyon && lille),
    createdCompetitionId || createdTeamIds.length ? `créés pour le contrôle (${createdTeamIds.length} équipe(s))` : "déjà en base",
  );

  // Créer 6 matchs terminés (scores connus)
  const testMatchIds = [];
  const matches = [
    ["PSG 3-0 Angers", psg, angers, 3, 0],
    ["Marseille 2-1 Lens", marseille, lens, 2, 1],
    ["Lyon 1-1 Lille", lyon, lille, 1, 1],
    ["PSG 2-0 Marseille", psg, marseille, 2, 0],
    ["Lens 1-0 Lyon", lens, lyon, 1, 0],
    ["Angers 0-1 Lille", angers, lille, 0, 1],
  ];
  for (const [, home, away, hs, as] of matches) {
    const id = cuid();
    db.prepare(`INSERT INTO Match (id,competitionId,homeTeamId,awayTeamId,homeScore,awayScore,status,scheduledAt,createdAt,updatedAt)
                VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      id, ligue1.id, home.id, away.id, hs, as, "FINISHED", "2026-09-01T20:00:00Z",
    );
    testMatchIds.push(id);
  }
  console.log(`   ${matches.length} matchs de test créés`);

  // 1) Navigation publique
  const home = await get("/");
  check("accueil : PublicNav (Accueil/Scores/Abonnement)", home.body.includes("Accueil") && home.body.includes("Scores") && home.body.includes("Abonnement"));
  check("accueil : lien « Voir les scores »", home.body.includes("Voir les scores") || home.body.includes("/scores"));

  // 2) /scores
  const scores = await get("/scores");
  check("GET /scores -> 200", scores.status === 200, `status=${scores.status}`);
  check("sections En direct / À venir / Terminés", scores.body.includes("En direct") && scores.body.includes("À venir") && scores.body.includes("Terminés récemment"));
  check("badge EN DIRECT possible (classe présent)", scores.body.includes("animate-pulse") || scores.body.includes("En direct"));
  check("filtres sport + compétition", scores.body.includes('name="sport"') && scores.body.includes('name="competition"'));

  // 3) /competition/french-ligue-1
  const comp = await get("/competition/french-ligue-1");
  check("GET /competition/french-ligue-1 -> 200", comp.status === 200, `status=${comp.status}`);
  check("titre compétition affiché", comp.body.includes("French Ligue 1") || comp.body.includes("Ligue 1"));
  check("tableau classement présent", comp.body.includes("Classement"));

  // Vérifier l'ordre du classement : PSG, Lille, Lens, Marseille, Lyon, Angers
  const expectedOrder = ["Paris Saint-Germain", "Lille", "Lens", "Marseille", "Lyon", "Angers"];
  const body = comp.body;
  let pos = -1;
  let orderOk = true;
  for (const name of expectedOrder) {
    const idx = body.indexOf(name);
    if (idx === -1 || idx < pos) { orderOk = false; }
    pos = idx;
  }
  check("classement trié correctement (points puis diff)", orderOk, expectedOrder.join(" > "));

  // 4) /match/[id]
  const firstMatch = testMatchIds[0];
  const detail = await get(`/match/${firstMatch}`);
  check("GET /match/[id] -> 200", detail.status === 200, `status=${detail.status}`);
  check("fiche match : équipes + score", detail.body.includes("Paris Saint-Germain") && detail.body.includes("Angers"));
  check("fiche match : lien compétition", detail.body.includes("/competition/french-ligue-1"));

  // 5) 404 sur match inexistant
  const missing = await get("/match/inexistant");
  check("match inexistant -> 404", missing.status === 404, `status=${missing.status}`);

  // 6) PublicNav masqué sur /login
  const login = await get("/login");
  check("PublicNav masqué sur /login", !login.body.includes("Voir les scores") || !login.body.includes("Scores"));

  // Nettoyage : uniquement les données créées par cette exécution.
  for (const id of testMatchIds) db.prepare("DELETE FROM Match WHERE id=?").run(id);
  for (const id of createdTeamIds) db.prepare("DELETE FROM Team WHERE id=?").run(id);
  if (createdCompetitionId) db.prepare("DELETE FROM Competition WHERE id=?").run(createdCompetitionId);
  db.close();
  console.log("   (matchs de test supprimés)");

  const failed = results.filter((r) => !r).length;
  console.log(`\nRESULTAT: ${results.length - failed}/${results.length} vérifications réussies`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERREUR:", e.stack); process.exit(1); });
