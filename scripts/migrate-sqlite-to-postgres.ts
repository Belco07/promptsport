/**
 * Migration des données SQLite → PostgreSQL (WP12a).
 *
 * Exécution : npm run db:migrate-sqlite-to-postgres
 *
 * Le schéma est identique des deux côtés : seuls le moteur et les types changent.
 * Ce script lit la base SQLite historique (`SQLITE_DATABASE_URL`), vide les tables
 * PostgreSQL puis réinsère les lignes dans l'ordre des dépendances, en convertissant
 * ce que SQLite stocke différemment :
 *
 *   * booléens : SQLite écrit 0/1, PostgreSQL exige true/false ;
 *   * Json : SQLite conserve du texte, PostgreSQL attend du JSONB (relu et
 *     analysé avant insertion) ;
 *   * dates : les deux bases stockent des horodatages UTC ; PostgreSQL les reçoit
 *     en `TIMESTAMP` sans fuseau (même heure murale, donc même instant) ;
 *   * énumérations : texte des deux côtés, le type natif PostgreSQL valide la valeur.
 *
 * L'insertion se fait ligne par ligne, avec plusieurs passes : une ligne dont la
 * clé étrangère n'est pas encore présente (commentaire enfant avant son parent,
 * par exemple) est simplement retentée à la passe suivante. Aucune contrainte
 * n'est désactivée, ce qui rend l'import vérifiable.
 *
 * À la fin : comptage des lignes table par table, avant et après. Le script sort
 * en erreur (code 1) si un seul comptage diffère.
 */
import path from "node:path";

import Database from "better-sqlite3";
import { Client } from "pg";

/**
 * Ordre d'import : chaque table vient après celles dont elle dépend.
 * `_NewsletterListToNewsletterSubscriber` ferme la marche (table de jointure
 * implicite de la relation plusieurs-à-plusieurs des listes de diffusion).
 */
const TABLES = [
  "Author",
  "Category",
  "Article",
  "AnalyticsVisitor",
  "AnalyticsDaily",
  "AnalyticsPageView",
  "Competition",
  "Team",
  "Match",
  "Plan",
  "Subscription",
  "SubscriptionEvent",
  "Payment",
  "Comment",
  "CommentReaction",
  "ArticleReaction",
  "Report",
  "Notification",
  "NewsletterList",
  "NewsletterSubscriber",
  "NewsletterCampaign",
  "NewsletterSend",
  "_NewsletterListToNewsletterSubscriber",
] as const;

/** Chemin du fichier SQLite à partir de `file:./prisma/dev.db`. */
function sqlitePath(url: string): string {
  return path.resolve(url.replace(/^file:(\/\/)?/, ""));
}

/** Vrai si la valeur SQLite doit devenir un booléen PostgreSQL. */
function toBoolean(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "true";
}

/** Convertit une valeur SQLite selon le type PostgreSQL de la colonne cible. */
function convert(value: unknown, pgType: string): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (pgType === "boolean") {
    return toBoolean(value);
  }
  if (pgType === "jsonb" || pgType === "json") {
    // node-postgres convertit un tableau JS en littéral de tableau PostgreSQL
    // (`{...}`), que JSONB refuse ("invalid input syntax for type json"). On
    // transmet donc toujours du texte JSON, que PostgreSQL analyse lui-même.
    if (typeof value === "string") {
      try {
        return JSON.stringify(JSON.parse(value));
      } catch {
        // Valeur non-JSON en base : on la transmet telle quelle plutôt que de la perdre.
        return value;
      }
    }
    return JSON.stringify(value);
  }
  // Les colonnes numériques (INTEGER) restent des nombres ; les dates et les
  // énumérations sont transmises sous forme de chaînes, PostgreSQL les valide.
  return value;
}

async function main(): Promise<void> {
  // .env d'abord : la CLI Prisma le lit pour ses commandes, mais un script tsx
  // lancé par npm démarre sans environnement. Le lecteur natif de Node suffit.
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void })
    .loadEnvFile;
  if (typeof loadEnvFile === "function") {
    try {
      loadEnvFile();
    } catch {
      console.warn("Fichier .env absent : l'environnement du shell est utilisé seul.");
    }
  }

  const sqliteUrl = process.env.SQLITE_DATABASE_URL ?? "file:./prisma/dev.db";
  const target = process.env.DATABASE_URL;

  if (!target) {
    console.error("DATABASE_URL (PostgreSQL) est absente : renseignez .env.");
    process.exit(1);
  }
  if (target.startsWith("file:")) {
    console.error("DATABASE_URL pointe encore vers SQLite ; cette migration vise PostgreSQL.");
    process.exit(1);
  }

  const source = new Database(sqlitePath(sqliteUrl), { readonly: true });
  const client = new Client({ connectionString: target });
  await client.connect();

  console.log(`Source : ${sqliteUrl}`);
  console.log(`Cible  : ${target.replace(/:[^:@/]+@/, ":****@")}`);
  console.log("");

  // Types PostgreSQL par table, pour convertir les booléens et le JSON.
  const { rows: columnRows } = await client.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'`,
  );
  const typesByTable = new Map<string, Map<string, string>>();
  for (const row of columnRows) {
    if (!typesByTable.has(row.table_name)) {
      typesByTable.set(row.table_name, new Map());
    }
    typesByTable.get(row.table_name)?.set(row.column_name, row.data_type);
  }

  // Table vide : une seule instruction, l'ordre inverse n'a pas d'importance
  // grâce à CASCADE (les dépendances sont recréées par l'import).
  await client.query(
    `TRUNCATE ${TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );

  const report: { table: string; before: number; after: number }[] = [];

  for (const table of TABLES) {
    const columns = typesByTable.get(table);
    if (!columns) {
      console.error(`Table absente de PostgreSQL : ${table}`);
      process.exit(1);
    }

    const rows = source.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    const names = [...columns.keys()];

    let inserted = 0;
    let pending = rows;

    // Plusieurs passes : une ligne dont une clé étrangère manque encore est
    // retentée après l'insertion des autres.
    for (let pass = 0; pass < 4 && pending.length > 0; pass += 1) {
      const failed: Record<string, unknown>[] = [];

      for (const row of pending) {
        const values = names.map((name) => convert(row[name], columns.get(name) ?? "text"));
        const placeholders = names.map((_, index) => `$${index + 1}`).join(", ");
        try {
          await client.query(
            `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${placeholders})`,
            values,
          );
          inserted += 1;
        } catch (error) {
          failed.push(row);
          if (pass === 3) {
            console.error(
              `  ✗ ${table} : ligne non importée (${error instanceof Error ? error.message : error})`,
            );
          }
        }
      }

      pending = failed;
    }

    report.push({ table, before: rows.length, after: inserted });
  }

  console.log("Table                                   SQLite   PostgreSQL");
  console.log("-----------------------------------------------------------------");
  let mismatches = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  for (const line of report) {
    const ok = line.before === line.after;
    if (!ok) {
      mismatches += 1;
    }
    totalBefore += line.before;
    totalAfter += line.after;
    console.log(
      `${ok ? " " : "!"} ${line.table.padEnd(36)} ${String(line.before).padStart(6)}   ${String(line.after).padStart(10)}`,
    );
  }
  console.log("-----------------------------------------------------------------");
  console.log(`  ${"TOTAL".padEnd(36)} ${String(totalBefore).padStart(6)}   ${String(totalAfter).padStart(10)}`);
  console.log("");

  if (mismatches > 0) {
    console.error(`${mismatches} table(s) avec un écart de comptage : migration incomplète.`);
    await client.end();
    source.close();
    process.exit(1);
  }

  console.log("Migration terminée : les comptages SQLite et PostgreSQL sont identiques.");
  await client.end();
  source.close();
}

main().catch((error) => {
  console.error("ERREUR:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
