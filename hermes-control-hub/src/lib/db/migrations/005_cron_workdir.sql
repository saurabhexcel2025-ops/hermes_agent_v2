-- Add workdir column to cron_jobs so Hermes can be instructed to run
-- with a specific working directory (enabling AGENTS.md / .cursorrules
-- context-file discovery in the target repository).
-- Idempotent: only applies if the column does not yet exist.
-- (The baseline schema also includes this column, so on fresh installs the
-- column is present before this migration runs; on upgraded installs the
-- check prevents a "duplicate column" error.)
PRAGMA if_null((SELECT 0 FROM pragma_table_info('cron_jobs') WHERE name='workdir'), 1);
ALTER TABLE cron_jobs ADD COLUMN workdir TEXT NOT NULL DEFAULT '';
UPDATE cron_jobs SET workdir = '' WHERE workdir IS NULL;
