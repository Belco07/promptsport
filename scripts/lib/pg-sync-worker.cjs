/**
 * Fil d'exécution PostgreSQL de la passerelle synchrone (scripts/lib/pg-sync.cjs).
 *
 * Le module principal bloque le fil courant avec `Atomics.wait` : tout le travail
 * réseau se fait donc ici, dans un fil séparé qui possède une unique connexion
 * `pg`. Le protocole est volontairement minimal — une requête à la fois, une
 * réponse par requête — car la passerelle est strictement séquentielle.
 *
 * Les valeurs renvoyées reproduisent celles que rendait better-sqlite3, afin que
 * les scripts de vérification n'aient pas à changer d'assertions :
 *   - booléens        -> 1 / 0
 *   - horodatages     -> texte ISO `AAAA-MM-JJTHH:MM:SS.mmm+00:00`
 *   - json / jsonb    -> texte JSON brut (et non un objet JS)
 *   - bigint          -> nombre
 */
const { workerData } = require("node:worker_threads");
const { Client, types } = require("pg");

const state = new Int32Array(workerData.sab);
/** Port de réponse : le fil appelant le lit avec `receiveMessageOnPort`. */
const port = workerData.port;

/** Convertit un horodatage PostgreSQL en texte ISO identique à Prisma/SQLite. */
function normalizeNaiveTimestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value);
  if (!match) {
    return value;
  }
  const millis = (match[3] ?? ".000").padEnd(4, "0").slice(0, 4);
  return `${match[1]}T${match[2]}${millis}+00:00`;
}

/** Types personnalisés : même contrat de valeurs que better-sqlite3. */
const customTypes = {
  getTypeParser(oid, format) {
    if (format === "text") {
      if (oid === 16) return (value) => (value === "t" ? 1 : 0);
      if (oid === 1114) return (value) => normalizeNaiveTimestamp(value);
      if (oid === 1184) return (value) => new Date(value).toISOString();
      if (oid === 114 || oid === 3802) return (value) => value;
      if (oid === 20) return (value) => Number(value);
    }
    return types.getTypeParser(oid, format);
  },
};

const client = new Client({ connectionString: workerData.connectionString, types: customTypes });

let connected = false;
let connectError = null;

const CATALOG = {
  tables: `SELECT table_name AS name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type IN ('BASE TABLE', 'VIEW')
           ORDER BY table_name`,
  indexes: `SELECT indexname AS name, tablename AS tbl_name FROM pg_indexes
            WHERE schemaname = 'public' ORDER BY indexname`,
  columns: `SELECT column_name AS name, data_type AS type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
};

async function ensureConnected() {
  if (connected) {
    return;
  }
  await client.connect();
  // Les horodatages sont stockés en UTC (colonnes `timestamp(3)` naïves) : la
  // session doit donc être en UTC pour que `now()` et les conversions de fuseau
  // restent cohérentes avec ce qu'écrit Prisma.
  await client.query("SET TIME ZONE 'UTC'");
  connected = true;
}

function plainRows(result) {
  return result.rows.map((row) => ({ ...row }));
}

async function handle(message) {
  switch (message.op) {
    case "ready":
      await ensureConnected();
      return { ok: true };
    case "query": {
      await ensureConnected();
      const result = await client.query(message.sql, message.params ?? []);
      return { ok: true, rows: plainRows(result), changes: result.rowCount ?? 0 };
    }
    case "catalog": {
      await ensureConnected();
      if (message.kind === "columns") {
        const result = await client.query(CATALOG.columns, [message.table]);
        return { ok: true, rows: plainRows(result) };
      }
      const result = await client.query(CATALOG[message.kind]);
      return { ok: true, rows: plainRows(result) };
    }
    case "close":
      if (connected) {
        await client.end();
        connected = false;
      }
      return { ok: true };
    default:
      throw new Error(`opération inconnue : ${message.op}`);
  }
}

port.on("message", (message) => {
  handle(message)
    .then((response) => {
      port.postMessage({ id: message.id, ...response });
    })
    .catch((error) => {
      if (!connected) {
        connectError = error;
      }
      port.postMessage({
        id: message.id,
        ok: false,
        error: {
          message: String(error?.message ?? error),
          code: error?.code ?? null,
          detail: error?.detail ?? null,
        },
      });
    })
    .finally(() => {
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
    });
});

// Une erreur de connexion initiale doit être réveillée même sans message.
process.on("unhandledRejection", (error) => {
  connectError = error;
  Atomics.store(state, 0, 1);
  Atomics.notify(state, 0);
});
