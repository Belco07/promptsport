#!/usr/bin/env node
/**
 * WP19a-bis — Phase 1 : validation d'AllSportsApi avant toute adaptation.
 *
 * Trois tests, dans l'ordre du brief :
 *   1. liste des ligues ;
 *   2. équipes d'une ligue (Ligue 1) ;
 *   3. matchs de la saison en cours + présence de scores en direct.
 *
 * Pour chacun : statut HTTP, nombre d'éléments, présence de la saison en cours,
 * présence de matchs en direct et quota restant (en-tête `x-ratelimit-requests-remaining`
 * de RapidAPI). Si un contrôle échoue, le script s'arrête : on reste sur
 * API-Football 2024 (WP19a en pause).
 *
 * Exécution :
 *   node scripts/test-allsports.cjs
 *
 * Contraintes : 5 requêtes/seconde maximum (espacement de 320 ms), plafond de
 * 10 requêtes par exécution sur un quota gratuit de 100/jour. La clé
 * `ALLSPORTS_API_KEY` est lue dans `.env` et n'est jamais affichée.
 *
 * Accès constaté le 09/10/2026 : l'API répond via **RapidAPI**
 * (`allsportsapi2.p.rapidapi.com`, en-têtes `x-rapidapi-key` / `x-rapidapi-host`)
 * et non via `allsportsapi.com` / `apiv2.allsportsapi.com`, qui rejettent cette
 * clé (« Wrong login credentials », « File not found »). Les trois modes restent
 * testés dans l'ordre, le premier qui répond servant aux tests suivants.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const REQUESTS_PER_SECOND = 5;
const MIN_INTERVAL_MS = Math.ceil(1000 / REQUESTS_PER_SECOND) + 120;
const REQUEST_BUDGET = 10;
const TIMEOUT_MS = 30000;

/** Année de la saison en cours attendue (exercice 2026-2027). */
const EXPECTED_SEASON_YEARS = ["26/27", "2026", "2027", "2026/2027", "2025/2026", "25/26"];

let requestCount = 0;
let lastRequestAt = 0;
let quotaRemaining = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readKey() {
  const env = Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, ".env"), "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z]/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
      }),
  );
  return env.ALLSPORTS_API_KEY ?? "";
}

/** Modes d'accès candidats, testés dans l'ordre (RapidAPI d'abord : c'est celui qui répond). */
const MODES = [
  {
    id: "rapidapi",
    label: "RapidAPI (x-rapidapi-key / x-rapidapi-host : allsportsapi2)",
    build: (endpoint) => `https://allsportsapi2.p.rapidapi.com${endpoint}`,
    headers: (key) => ({ "x-rapidapi-key": key, "x-rapidapi-host": "allsportsapi2.p.rapidapi.com" }),
  },
  {
    id: "apiv2",
    label: "AllSportsApi apiv2 (APIkey en paramètre)",
    build: (endpoint, key) => `https://apiv2.allsportsapi.com/football${endpoint}?APIkey=${encodeURIComponent(key)}`,
    headers: () => ({}),
  },
  {
    id: "direct",
    label: "AllSportsApi direct (APIkey en paramètre)",
    build: (endpoint, key) => `https://allsportsapi.com/api/football${endpoint}?APIkey=${encodeURIComponent(key)}`,
    headers: () => ({}),
  },
];

/** Appel HTTP sérialisé : jamais plus de 5 requêtes/seconde. */
async function call(mode, endpoint, key) {
  if (requestCount >= REQUEST_BUDGET) {
    throw new Error(`Plafond de ${REQUEST_BUDGET} requêtes atteint pour cette exécution.`);
  }
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);

  const url = mode.build(endpoint, key);
  requestCount += 1;
  lastRequestAt = Date.now();

  const started = Date.now();
  const response = await fetch(url, {
    headers: mode.headers(key),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  const remaining = response.headers.get("x-ratelimit-requests-remaining");
  if (remaining !== null) quotaRemaining = remaining;

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { status: response.status, ms: Date.now() - started, json, text, remaining };
}

/**
 * Tableau utile d'une réponse AllSportsApi.
 *
 * L'API encapsule ses données dans des clés nommées (`categories`, `events`,
 * `teams`, `seasons`…) et parfois dans un niveau intermédiaire : `groups[].uniqueTournaments`
 * pour les ligues d'une catégorie, `results[].entity` pour la recherche.
 */
function payloadRows(json, key) {
  if (!json || typeof json !== "object") return null;
  if (key && Array.isArray(json[key])) return json[key];
  for (const name of ["categories", "events", "teams", "seasons", "uniqueTournaments", "results", "data", "result"]) {
    if (Array.isArray(json[name])) return json[name];
  }
  // `groups: [{ uniqueTournaments: [...] }, …]` (ligues d'une catégorie).
  if (Array.isArray(json.groups)) {
    return json.groups.flatMap((group) =>
      ["uniqueTournaments", "tournaments", "events"].flatMap((name) =>
        Array.isArray(group?.[name]) ? group[name] : [],
      ),
    );
  }
  return null;
}

/** Résultats de recherche : `{ results: [{ entity: {...} }] }` → entités. */
function searchEntities(json) {
  const rows = payloadRows(json, "results");
  if (!rows) return null;
  return rows.map((row) => row?.entity ?? row).filter(Boolean);
}

/** Nom lisible d'une entité, quelle que soit la forme renvoyée. */
const entityName = (row) => String(row?.name ?? row?.league_name ?? row?.team_name ?? row?.country_name ?? "");

function printQuota() {
  console.log(
    quotaRemaining === null
      ? "  quota : non communiqué par l'API"
      : `  quota restant (x-ratelimit-requests-remaining) : ${quotaRemaining}`,
  );
}

async function main() {
  const key = readKey();
  console.log("=== WP19a-bis — Validation AllSportsApi (Phase 1) ===");
  if (!key) {
    console.log("ECHEC | ALLSPORTS_API_KEY absente de .env : validation impossible.");
    process.exitCode = 1;
    return;
  }
  console.log(`Clé lue dans .env : ${key.slice(0, 4)}… (${key.length} caractères, jamais affichée)`);
  console.log(`Débit : ${REQUESTS_PER_SECOND} requêtes/seconde maximum, plafond de ${REQUEST_BUDGET} requêtes pour cette exécution.`);
  console.log(`Fenêtre saison attendue : ${EXPECTED_SEASON_YEARS.slice(0, 5).join(", ")}\n`);

  /* ------------------------------------------------ mode d'accès */
  let mode = null;
  let categories = [];
  for (const candidate of MODES) {
    try {
      const response = await call(candidate, "/api/tournament/categories", key);
      const rows = payloadRows(response.json);
      console.log(`[mode ${candidate.id}] ${candidate.label}`);
      console.log(`  HTTP ${response.status} en ${response.ms} ms — ${rows ? rows.length : 0} élément(s)`);
      printQuota();
      if (response.status === 200 && rows && rows.length > 0) {
        mode = candidate;
        categories = rows;
        console.log("  -> mode retenu.\n");
        break;
      }
      console.log(`  ECHEC : ${response.json?.message ?? response.text.replace(/\s+/g, " ").slice(0, 120)}\n`);
    } catch (error) {
      console.log(`  ECHEC | mode ${candidate.id} : ${error.message}\n`);
    }
  }

  if (!mode) {
    console.log("=== DECISION : validation IMPOSSIBLE ===");
    console.log("Aucun mode d'accès n'a renvoyé de ligues : on reste sur API-Football 2024 (WP19a).");
    process.exitCode = 1;
    return;
  }

  const checks = [];
  const record = (label, ok, detail) => {
    checks.push({ label, ok });
    console.log(`  ${ok ? "OK   " : "ECHEC"} | ${label}${detail ? ` -> ${detail}` : ""}`);
  };

  /* ------------------------------------------------ test 1 : ligues */
  console.log("--- Test 1/3 : liste des ligues ---");
  const france = categories.find((row) => /france/i.test(entityName(row)));
  record("endpoint « ligues » retourne des données", categories.length > 0, `${categories.length} catégorie(s)`);
  record("la France figure parmi les catégories", Boolean(france), france ? `id=${france.id}` : "absente");

  let ligue1 = null;
  let leagues = [];
  if (france) {
    const response = await call(mode, `/api/tournament/all/category/${france.id}`, key);
    leagues = payloadRows(response.json) ?? [];
    // Repli : la recherche d'API nomme directement les ligues.
    if (!leagues.some((row) => /ligue 1/i.test(entityName(row)))) {
      const search = await call(mode, "/api/search/unique-tournaments?q=ligue%201", key);
      const found = searchEntities(search.json) ?? [];
      if (found.length > 0) leagues = [...leagues, ...found];
    }
    ligue1 = leagues.find((row) => /ligue 1/i.test(entityName(row)));
    record("ligues de la catégorie France récupérées", leagues.length > 0, `${leagues.length} ligue(s)`);
    record(
      "Ligue 1 identifiée (identifiant de tournoi)",
      Boolean(ligue1),
      ligue1 ? `id=${ligue1.id} (${entityName(ligue1)})` : "absente",
    );
    printQuota();
  }

  /* ------------------------------------------------ test 2 : équipes */
  console.log("\n--- Test 2/3 : équipes de Ligue 1 ---");
  const tournamentId = ligue1?.id;
  let seasons = [];
  let season = null;
  let teams = [];
  if (tournamentId) {
    const seasonsResponse = await call(mode, `/api/tournament/${tournamentId}/seasons`, key);
    seasons = payloadRows(seasonsResponse.json) ?? [];
    const seasonLabel = (row) => String(row?.year ?? row?.name ?? row?.season ?? "");
    season =
      seasons.find((row) => EXPECTED_SEASON_YEARS.includes(seasonLabel(row))) ??
      seasons.slice().sort((a, b) => String(seasonLabel(b)).localeCompare(String(seasonLabel(a))))[0] ??
      null;
    record("saisons de la compétition récupérées", seasons.length > 0, `${seasons.length} saison(s)`);
    record(
      "saison en cours accessible",
      Boolean(season) && EXPECTED_SEASON_YEARS.includes(seasonLabel(season)),
      season ? `${seasonLabel(season)} (id=${season.id})` : `aucune (vu : ${seasons.slice(0, 3).map(seasonLabel).join(", ")})`,
    );
    printQuota();

    if (season) {
      const teamsResponse = await call(mode, `/api/tournament/${tournamentId}/season/${season.id}/teams`, key);
      teams = payloadRows(teamsResponse.json) ?? [];
      const sample = teams[0] ?? {};
      record("endpoint « équipes » répond", teamsResponse.status === 200, `HTTP ${teamsResponse.status}`);
      record("équipes retournées", teams.length > 0, `${teams.length} équipe(s)`);
      record(
        "champs utiles présents (nom, identifiant, logo)",
        Boolean(sample.name && sample.id && (sample.fieldTranslations || sample.name)),
        sample.name ?? "?",
      );
      printQuota();
    }
  }

  /* ------------------------------------------------ test 3 : matchs + direct */
  console.log("\n--- Test 3/3 : matchs de la saison en cours et scores en direct ---");
  let matchCount = 0;
  if (tournamentId && season) {
    const last = await call(mode, `/api/tournament/${tournamentId}/season/${season.id}/matches/last/0`, key);
    const next = await call(mode, `/api/tournament/${tournamentId}/season/${season.id}/matches/next/0`, key);
    const lastEvents = payloadRows(last.json) ?? [];
    const nextEvents = payloadRows(next.json) ?? [];
    matchCount = lastEvents.length + nextEvents.length;
    record("matchs déjà joués récupérés", lastEvents.length > 0, `${lastEvents.length} match(s)`);
    record("matchs à venir récupérés", nextEvents.length > 0, `${nextEvents.length} match(s)`);
    const withScore = [...lastEvents, ...nextEvents].find(
      (event) => event?.homeScore?.current !== undefined || event?.awayScore?.current !== undefined,
    );
    record(
      "scores présents dans les données de match",
      Boolean(withScore),
      withScore
        ? `${withScore.homeTeam?.name ?? "?"} ${withScore.homeScore?.current ?? "-"} - ${withScore.awayScore?.current ?? "-"} ${withScore.awayTeam?.name ?? "?"}`
        : "aucun score exploitable",
    );
    printQuota();
  }

  const liveResponse = await call(mode, "/api/matches/live", key);
  const liveEvents = payloadRows(liveResponse.json) ?? [];
  const inPlay = liveEvents.filter((event) => {
    const status = String(event?.status?.type ?? event?.status?.description ?? "");
    return /inprogress|in_progress|live|1h|2h|ht|halftime/i.test(status) || event?.status?.code === 6 || event?.status?.code === 7;
  });
  record("endpoint « matchs en direct » répond", liveResponse.status === 200, `HTTP ${liveResponse.status}`);
  record("matchs en direct disponibles", liveEvents.length > 0, `${liveEvents.length} match(s) listé(s)`);
  record(
    "au moins un match en LIVE / IN_PLAY",
    inPlay.length > 0,
    `${inPlay.length} match(s) en cours`,
  );
  if (inPlay[0]) {
    console.log(
      `         exemple : ${inPlay[0].homeTeam?.name ?? "?"} - ${inPlay[0].awayTeam?.name ?? "?"} (${inPlay[0].tournament?.name ?? "?"}, statut ${inPlay[0].status?.type ?? "?"})`,
    );
  } else if (liveEvents[0]) {
    console.log(
      `         exemple : ${liveEvents[0].homeTeam?.name ?? "?"} - ${liveEvents[0].awayTeam?.name ?? "?"} (${liveEvents[0].tournament?.name ?? "?"}, statut ${liveEvents[0].status?.type ?? "?"})`,
    );
  }
  printQuota();

  /* ------------------------------------------------ bilan */
  const failed = checks.filter((entry) => !entry.ok);
  console.log("\n=== BILAN ===");
  console.log(`Mode retenu : ${mode.id} (${mode.label})`);
  console.log(`Catégories : ${categories.length} | ligues (France) : ${leagues.length} | équipes Ligue 1 : ${teams.length} | matchs analysés : ${matchCount} | directs : ${liveEvents.length}`);
  console.log(`Quota restant : ${quotaRemaining ?? "non communiqué"}`);
  console.log(`Requêtes consommées : ${requestCount}/${REQUEST_BUDGET}`);
  console.log(`Contrôles réussis : ${checks.length - failed.length}/${checks.length}`);
  for (const entry of failed) console.log(`  - ${entry.label}`);

  if (failed.length === 0) {
    console.log("\n=== DECISION : VALIDATION OK -> Phase 2 (adaptation du service) autorisée ===");
    process.exitCode = 0;
  } else {
    console.log("\n=== DECISION : VALIDATION EN ECHEC -> on reste sur API-Football 2024 (WP19a), pas d'adaptation ===");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("ECHEC | exécution du script :", error);
  process.exitCode = 1;
});
