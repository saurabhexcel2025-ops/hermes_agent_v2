// ═══════════════════════════════════════════════════════════════
// db-schema.ts — SQLite schema version helpers
// These are extracted to a separate module so they can be imported
// by migration files without being intercepted by the global
// @/lib/db mock in Jest tests.
// ═══════════════════════════════════════════════════════════════

const SCHEMA_VERSION_KEY = "schema_version";

export function getSchemaVersion(database: { prepare: (sql: string) => { get: (key: string) => { value: string } | undefined } }): number {
  try {
    const row = database
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  } catch {
    return 0;
  }
}

export function setSchemaVersion(database: { prepare: (sql: string) => { run: (key: string, value: string) => void } }, version: number): void {
  database
    .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
    .run(SCHEMA_VERSION_KEY, String(version));
}
