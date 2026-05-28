-- Repair mission-linked cron jobs that were stored as one-shot (times: 1) due to
-- parseRepeatJson null-coalescing bug fixed in 705e607 (May 2026).
UPDATE cron_jobs
SET repeat_json = '{"times":null,"completed":0}',
    updated_at = datetime('now')
WHERE source = 'ch'
  AND json_extract(repeat_json, '$.times') = 1
  AND id IN (
    SELECT cron_job_id FROM missions
    WHERE cron_job_id IS NOT NULL
  );
