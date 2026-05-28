import { readFileSync } from "fs";
import { join } from "path";

export const baselineSqlPath = join(
  __dirname,
  "..",
  "..",
  "src",
  "lib",
  "db",
  "migrations",
  "001_baseline.sql"
);

/** Apply the current squashed baseline schema. */
export function execBaselineSchema(database: import("better-sqlite3").Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  database.exec(readFileSync(baselineSqlPath, "utf-8"));
  database
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .run("schema_version", "3");
}
