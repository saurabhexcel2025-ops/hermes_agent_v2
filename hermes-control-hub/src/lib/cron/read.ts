// ═══════════════════════════════════════════════════════════════
// cron/read.ts — list/get cron jobs from SQLite
// ═══════════════════════════════════════════════════════════════

import { db } from "../db";
import { safeJsonParse } from "../utils";

import type { CronJobRecord, CronJobRow } from "./types";

function rowToRecord(row: CronJobRow): CronJobRecord {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    skills: safeJsonParse(row.skills, [] as string[]),
    model: row.model,
    provider: row.provider,
    base_url: row.base_url,
    schedule: row.schedule,
    schedule_display: row.schedule_display,
    repeat: safeJsonParse(row.repeat_json, { times: 1, completed: 0 }),
    enabled: row.enabled === 1,
    state: row.state,
    deliver: row.deliver,
    script: row.script,
    profile_name: row.profile_name,
    hermes_job_id: row.hermes_job_id,
    source: row.source as "ch" | "hermes",
    orphan: row.orphan === 1,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at,
    last_status: row.last_status,
    last_delivery_error: row.last_delivery_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    workdir: row.workdir ?? "",
  };
}

/** List all cron jobs from CH SQLite. */
export function listCronJobs(): CronJobRecord[] {
  const rows = db()
    .prepare("SELECT * FROM cron_jobs ORDER BY created_at DESC")
    .all() as CronJobRow[];
  return rows.map(rowToRecord);
}

/** Get a single cron job by CH id. */
export function getCronJob(id: string): CronJobRecord | null {
  const row = db()
    .prepare("SELECT * FROM cron_jobs WHERE id = ?")
    .get(id) as CronJobRow | undefined;
  return row ? rowToRecord(row) : null;
}

/** Get a cron job by its Hermes job id. */
export function getCronJobByHermesId(hermes_job_id: string): CronJobRecord | null {
  const row = db()
    .prepare("SELECT * FROM cron_jobs WHERE hermes_job_id = ?")
    .get(hermes_job_id) as CronJobRow | undefined;
  return row ? rowToRecord(row) : null;
}
