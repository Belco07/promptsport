/**
 * Passerelle synchrone vers PostgreSQL pour les scripts de vérification.
 *
 * Les suites `scripts/check-*.cjs` ont été écrites contre better-sqlite3, dont
 * l'API est **synchrone** (`db.prepare(...).get()`), alors que `pg` est
 * asynchrone. Cette passerelle conserve l'API de better-sqlite3 (`prepare`,
 * `get`, `all`, `run`, `pragma`, `close`) en exécutant les requêtes dans un fil
 * séparé (`scripts/lib/pg-sync-worker.cjs`) : le fil appelant se bloque sur
 * `Atomics.wait` pendant que le fil PostgreSQL fait le travail réseau, puis
 * récupère la réponse avec `receiveMessageOnPort`.
 *
 * Elle adapte aussi le dialecte, pour que les requêtes SQLite des suites restent
 * lisibles et vérifient bien la base PostgreSQL réelle :
 *   - `?`                     -> `$1, $2, ...`
 *   - `Article`, `createdAt`  -> `"Article"`, `"createdAt"` (PostgreSQL replie
 *     les identifiants non cités en minuscules, ce qui casserait le camelCase)
 *   - booléens SQLite         -> `col = 0` devient `col = false`, et un
 *     paramètre `0/1` devient `($n::int <> 0)`
 *   - `PRAGMA table_info(X)`  -> information_schema.columns
 *   - `sqlite_master`         -> information_schema.tables / pg_indexes
 *   - `datetime('now')`       -> `now()` ; `substr(date, 1, 10)` -> `substr("date"::text, 1, 10)`
 *   - valeurs relues          -> booléens 1/0, horodatages ISO, JSON en texte
 *
 * Le chemin de fichier passé au constructeur est ignoré : la passerelle est
 * toujours branchée sur `DATABASE_URL` (PostgreSQL).
 *
 * Exécution : node scripts/check-xxx.cjs (le serveur Next doit tourner).
 */
const fs = require("node:fs");
const path = require("node:path");
const { Worker, MessageChannel, receiveMessageOnPort } = require("node:worker_threads");

const WORKER_PATH = path.join(__dirname, "pg-sync-worker.cjs");
const CALL_TIMEOUT_MS = 60_000;

/**
 * Mots réservés laissés intacts par la mise en guillemets des identifiants.
 * La liste est volontairement large : les identifiants réels du schéma
 * (Author, Article, createdAt, A, B…) ne collisionnent avec aucun d'eux.
 */
const KEYWORDS = new Set([
  "ALL", "AND", "ANY", "AS", "ASC", "BETWEEN", "BY", "CASE", "CAST", "COALESCE",
  "CONFLICT", "COUNT", "CURRENT_DATE", "CURRENT_TIME", "CURRENT_TIMESTAMP", "DATE",
  "DEFAULT", "DELETE", "DESC", "DISTINCT", "DO", "ELSE", "END", "EXCEPT", "EXISTS",
  "FALSE", "FILTER", "FIRST", "FROM", "FULL", "GROUP", "HAVING", "ILIKE", "IN",
  "INNER", "INSERT", "INTERVAL", "INTO", "IS", "JOIN", "LAST", "LEFT", "LIKE",
  "LIMIT", "MAX", "MIN", "NOT", "NOW", "NULL", "NULLS", "OFFSET", "ON", "OR",
  "ORDER", "OUTER", "OVER", "PARTITION", "PRAGMA", "RANDOM", "RETURNING", "RIGHT",
  "ROW_NUMBER", "SELECT", "SET", "SUBSTR", "SUM", "THEN", "TRUE", "UNION",
  "UNIQUE", "UPDATE", "USING", "VALUES", "WHEN", "WHERE", "WITH",
]);

/** Chaîne de connexion PostgreSQL, sans dépendre de l'environnement du shell. */
function resolveConnectionString(explicit) {
  if (typeof explicit === "string" && /^postgres(ql)?:\/\//.test(explicit)) {
    return explicit;
  }
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv && /^postgres(ql)?:\/\//.test(fromEnv)) {
    return fromEnv;
  }
  const envPath = path.resolve(__dirname, "..", "..", ".env");
  if (fs.existsSync(envPath)) {
    const match = /^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m.exec(fs.readFileSync(envPath, "utf8"));
    if (match && /^postgres(ql)?:\/\//.test(match[1])) {
      return match[1];
    }
  }
  throw new Error(
    "DATABASE_URL PostgreSQL introuvable : renseignez .env (postgresql://...) et vérifiez que le conteneur est démarré.",
  );
}

/** Normalise les paramètres à la manière de better-sqlite3. */
function normalizeParams(rawParams) {
  const params = rawParams.length === 1 && Array.isArray(rawParams[0]) ? rawParams[0] : [...rawParams];
  return params.map((value) => {
    if (value === undefined) {
      return null;
    }
    if (value instanceof Date) {
      // Prisma écrit les horodatages en UTC dans des colonnes `timestamp(3)`
      // naïves : on reproduit exactement ce format plutôt que de laisser `pg`
      // sérialiser la date avec le fuseau local de la machine.
      return value.toISOString().replace("T", " ").replace("Z", "");
    }
    return value;
  });
}

/** Découpe un texte SQL sur les virgules de premier niveau (hors chaînes et parenthèses). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      let end = index + 1;
      while (end < text.length) {
        if (text[end] === "'" && text[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (text[end] === "'") {
          break;
        }
        end += 1;
      }
      current += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  parts.push(current);
  return parts;
}

/** Réécritures de dialecte ponctuelles (SQLite -> PostgreSQL). */
function rewriteDialect(sql) {
  return sql
    .replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, "now()")
    .replace(
      /\bsubstr\s*\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*,\s*1\s*,\s*10\s*\)/gi,
      'substr("$1"::text, 1, 10)',
    );
}

/** Numérote les `?` en `$1, $2, ...` en ignorant chaînes et identifiants cités. */
function numberPlaceholders(sql) {
  let out = "";
  let index = 0;
  let cursor = 0;
  let placeholder = 0;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'" || char === '"') {
      let end = cursor + 1;
      while (end < sql.length) {
        if (sql[end] === char && sql[end + 1] === char) {
          end += 2;
          continue;
        }
        if (sql[end] === char) {
          break;
        }
        end += 1;
      }
      out += sql.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }
    if (char === "?") {
      placeholder += 1;
      out += `$${placeholder}`;
      cursor += 1;
      continue;
    }
    out += char;
    cursor += 1;
  }
  return out;
}

/** Cite les identifiants camelCase/PascalCase, que PostgreSQL replierait sinon. */
function quoteIdentifiers(sql) {
  let out = "";
  let cursor = 0;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'" || char === '"') {
      let end = cursor + 1;
      while (end < sql.length) {
        if (sql[end] === char && sql[end + 1] === char) {
          end += 2;
          continue;
        }
        if (sql[end] === char) {
          break;
        }
        end += 1;
      }
      out += sql.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = cursor;
      while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end])) {
        end += 1;
      }
      const word = sql.slice(cursor, end);
      const isKeyword = KEYWORDS.has(word.toUpperCase());
      out += !isKeyword && /[A-Z]/.test(word) ? `"${word}"` : word;
      cursor = end;
      continue;
    }
    out += char;
    cursor += 1;
  }
  return out;
}

/** Traduit les comparaisons et affectations booléennes (`= 0`, `= 1`, `= $n`). */
function rewriteBooleans(sql, booleanColumns) {
  if (booleanColumns.size === 0) {
    return sql;
  }
  // Les identifiants déjà cités (« isPremium ») et ceux restés en minuscules
  // (`read`, `active`) doivent tous deux être reconnus.
  const names = [...booleanColumns]
    .map((name) => `(?:"${name}"|\\b${name}\\b)`)
    .join("|");
  const comparison = new RegExp(`(${names})\\s*(=|<>|!=)\\s*(\\$\\d+|\\d+)`, "g");
  return sql.replace(comparison, (whole, column, operator, value) => {
    if (value.startsWith("$")) {
      return `${column} ${operator} (${value}::int <> 0)`;
    }
    return `${column} ${operator} ${value === "0" ? "false" : "true"}`;
  });
}

/** Traduit les valeurs booléennes des INSERT (position -> nom de colonne). */
function rewriteInsertBooleans(sql, booleanColumns) {
  if (booleanColumns.size === 0) {
    return sql;
  }
  const match = /^(\s*INSERT\s+INTO\s+)("[^"]+")(\s*\(([^)]*)\)\s*VALUES\s+)([\s\S]*)$/i.exec(sql);
  if (!match) {
    return sql;
  }
  const columns = splitTopLevel(match[4]).map((column) => column.trim().replace(/^"|"$/g, ""));
  if (!columns.some((column) => booleanColumns.has(column))) {
    return sql;
  }
  const tuples = splitTopLevel(match[5]).map((tuple) => {
    const trimmed = tuple.trim();
    if (!trimmed.startsWith("(")) {
      return trimmed;
    }
    const values = splitTopLevel(trimmed.slice(1, -1)).map((value, position) => {
      const column = columns[position];
      if (!column || !booleanColumns.has(column)) {
        return value.trim();
      }
      const literal = value.trim();
      if (literal === "0") return "false";
      if (literal === "1") return "true";
      if (/^\$\d+$/.test(literal)) return `(${literal}::int <> 0)`;
      return literal;
    });
    return `(${values.join(", ")})`;
  });
  return `${match[1]}${match[2]}${match[3]}${tuples.join(", ")}`;
}

/** Motif `LIKE` SQLite (insensible à la casse) converti en expression régulière. */
function likeMatcher(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

/** Traduit une requête SQLite en requête PostgreSQL + décrit les opérations catalogue. */
function translate(sql, booleanColumns) {
  const trimmed = sql.trim();

  const pragmaInfo = /^PRAGMA\s+table_info\s*\(\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\)$/i.exec(trimmed);
  if (pragmaInfo) {
    return { catalog: { kind: "columns", table: pragmaInfo[1] } };
  }
  if (/^PRAGMA\b/i.test(trimmed)) {
    // `PRAGMA foreign_keys = ON` : PostgreSQL applique toujours ses contraintes.
    return { skip: true };
  }
  if (/\bsqlite_master\b/i.test(trimmed)) {
    const type = /type\s*=\s*'(table|index)'/i.exec(trimmed)?.[1]?.toLowerCase();
    if (/select\s+sql\b/i.test(trimmed)) {
      throw new Error("sqlite_master.sql n'existe pas sous PostgreSQL : interrogez pg_constraint.");
    }
    const equality = /tbl_name\s*=\s*'([^']*)'/i.exec(trimmed)?.[1];
    const like = /tbl_name\s+LIKE\s+'([^']*)'/i.exec(trimmed)?.[1];
    const named = /\bname\s*=\s*'([^']*)'/i.exec(trimmed)?.[1];
    return {
      catalog:
        type === "index"
          ? { kind: "indexes", filter: { table: equality ?? null, tableLike: like ?? null } }
          : { kind: "tables", filter: { name: named ?? null } },
    };
  }

  let translated = rewriteDialect(trimmed);
  translated = numberPlaceholders(translated);
  translated = quoteIdentifiers(translated);
  translated = rewriteBooleans(translated, booleanColumns);
  translated = rewriteInsertBooleans(translated, booleanColumns);
  return { sql: translated };
}

/** Canal synchrone vers le fil PostgreSQL. */
class PgSyncBridge {
  constructor(connectionString) {
    this.state = new Int32Array(new SharedArrayBuffer(4));
    this.channel = new MessageChannel();
    this.sequence = 0;
    this.fatal = null;
    this.worker = new Worker(WORKER_PATH, {
      workerData: { connectionString, sab: this.state.buffer, port: this.channel.port2 },
      transferList: [this.channel.port2],
    });
    // Le fil ne doit pas empêcher le processus de se terminer.
    this.worker.unref();
    this.worker.on("error", (error) => {
      this.fatal = error;
      Atomics.store(this.state, 0, 1);
      Atomics.notify(this.state, 0);
    });
    this.call({ op: "ready" });
  }

  call(message) {
    this.sequence += 1;
    const id = this.sequence;
    Atomics.store(this.state, 0, 0);
    this.channel.port1.postMessage({ id, ...message });
    const status = Atomics.wait(this.state, 0, 0, CALL_TIMEOUT_MS);
    if (status === "timed-out") {
      throw new Error(
        this.fatal
          ? `passerelle PostgreSQL interrompue : ${this.fatal.message}`
          : `passerelle PostgreSQL sans réponse après ${CALL_TIMEOUT_MS} ms (conteneur ${"promptsport-pg"} démarré ?)`,
      );
    }
    const received = receiveMessageOnPort(this.channel.port1);
    if (!received) {
      throw new Error("réponse PostgreSQL illisible (canal vide)");
    }
    const response = received.message;
    if (response.id !== id) {
      throw new Error(`réponse PostgreSQL désynchronisée (attendu ${id}, reçu ${response.id})`);
    }
    if (!response.ok) {
      const error = new Error(`requête PostgreSQL échouée : ${response.error.message}`);
      error.code = response.error.code;
      error.detail = response.error.detail;
      throw error;
    }
    return response;
  }

  close() {
    try {
      this.call({ op: "close" });
    } catch {
      // La connexion est peut-être déjà fermée : la fermeture reste silencieuse.
    }
    this.worker.terminate();
  }
}

/** Jeu d'instructions compatible better-sqlite3. */
class PgSyncStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.plan = translate(sql, database.booleanColumns);
  }

  #rows(params) {
    if (this.plan.skip) {
      return [];
    }
    if (this.plan.catalog) {
      return this.database.catalogRows(this.plan.catalog);
    }
    const response = this.database.bridge.call({
      op: "query",
      sql: this.plan.sql,
      params: normalizeParams(params),
    });
    return response.rows;
  }

  all(...params) {
    return this.#rows(params);
  }

  get(...params) {
    return this.#rows(params)[0];
  }

  run(...params) {
    const response = this.database.bridge.call({
      op: "query",
      sql: this.plan.sql,
      params: normalizeParams(params),
    });
    return { changes: response.changes, lastInsertRowid: null };
  }

  bind() {
    return this;
  }

  iterate(...params) {
    return this.#rows(params)[Symbol.iterator]();
  }
}

/** Base de données synchrone branchée sur PostgreSQL. */
class PgSyncDatabase {
  constructor(source, options = {}) {
    this.connectionString = resolveConnectionString(source);
    this.readonly = Boolean(options.readonly);
    this.bridge = new PgSyncBridge(this.connectionString);
    this.boolCache = null;
    this.catalogCache = new Map();
  }

  get name() {
    return "postgresql";
  }

  /** Colonnes booléennes du schéma : nécessaires pour traduire 0/1 en true/false. */
  get booleanColumns() {
    if (!this.boolCache) {
      const response = this.bridge.call({
        op: "query",
        sql: `SELECT DISTINCT column_name AS name FROM information_schema.columns
              WHERE table_schema = 'public' AND data_type = 'boolean'`,
        params: [],
      });
      this.boolCache = new Set(response.rows.map((row) => row.name));
    }
    return this.boolCache;
  }

  /** Répond aux pseudo-requêtes de catalogue (PRAGMA table_info, sqlite_master). */
  catalogRows({ kind, table, filter }) {
    const key = JSON.stringify({ kind, table, filter });
    if (this.catalogCache.has(key)) {
      return this.catalogCache.get(key);
    }
    const response = this.bridge.call(
      kind === "columns"
        ? { op: "catalog", kind, table }
        : { op: "catalog", kind: kind === "tables" ? "tables" : "indexes" },
    );
    let rows = response.rows;
    if (kind === "indexes") {
      const wanted = filter?.table ?? null;
      const pattern = filter?.tableLike ? likeMatcher(filter.tableLike) : null;
      rows = rows.filter((row) => {
        if (wanted !== null && row.tbl_name !== wanted) return false;
        if (pattern && !pattern.test(row.tbl_name)) return false;
        return true;
      });
    }
    if (kind === "tables" && filter?.name) {
      rows = rows.filter((row) => row.name === filter.name);
    }
    // `type` : colonne de sqlite_master (« table » / « index »). Attention à ne
    // PAS l'ajouter aux colonnes : `PRAGMA table_info` expose déjà un champ
    // `type` qui porte le type SQL de la colonne (TEXT, INTEGER…).
    if (kind !== "columns") {
      rows = rows.map((row) => ({ ...row, type: kind === "indexes" ? "index" : "table" }));
    }
    this.catalogCache.set(key, rows);
    return rows;
  }

  prepare(sql) {
    return new PgSyncStatement(this, sql);
  }

  exec(sql) {
    for (const statement of splitStatements(sql)) {
      if (statement.trim()) {
        this.bridge.call({ op: "query", sql: statement.trim(), params: [] });
      }
    }
    return this;
  }

  pragma(text) {
    // `foreign_keys` est toujours actif sous PostgreSQL ; les autres pragmas
    // SQLite n'ont pas d'équivalent utile ici.
    if (/table_info/i.test(text)) {
      const table = /\(([^)]*)\)/.exec(text)?.[1]?.trim().replace(/^"|"$/g, "");
      return table ? this.catalogRows({ kind: "columns", table }) : [];
    }
    return undefined;
  }

  transaction(fn) {
    return (...args) => fn(...args);
  }

  close() {
    this.bridge.close();
  }
}

/** Découpe un script SQL en instructions (utilisé par `exec`). */
function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

module.exports = PgSyncDatabase;
module.exports.PgSyncDatabase = PgSyncDatabase;
