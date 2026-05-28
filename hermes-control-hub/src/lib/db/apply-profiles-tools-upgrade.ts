import type Database from "better-sqlite3";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getSchemaVersion, setSchemaVersion } from "@/lib/db-schema";
import {
  ensureProfilesToolsParity,
  PROFILES_TOOLS_PARITY_SCHEMA_VERSION,
} from "./profiles-tools-parity-ensure";

/**
 * Apply 002_profiles_tools_parity.sql when meta schema_version is below 3.
 * File prefix 002 is a migration sequence id, not the target schema version.
 */
export function applyProfilesToolsParityUpgrade(
  database: Database.Database,
  migrationsDir: string,
): number {
  const current = getSchemaVersion(database);
  if (current >= PROFILES_TOOLS_PARITY_SCHEMA_VERSION) {
    ensureProfilesToolsParity(database);
    return current;
  }

  if (existsSync(migrationsDir)) {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const num = parseInt(file.split("_")[0], 10);
      if (isNaN(num) || num <= 1) continue;
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      try {
        database.exec(sql);
      } catch {
        // Partial v2 DBs may already have some ALTERs; idempotent ensure below.
      }
    }
  }

  ensureProfilesToolsParity(database);
  setSchemaVersion(database, PROFILES_TOOLS_PARITY_SCHEMA_VERSION);
  return PROFILES_TOOLS_PARITY_SCHEMA_VERSION;
}
