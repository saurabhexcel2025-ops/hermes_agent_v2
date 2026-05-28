-- Mission queue: distinguish drafts (save) from missions waiting for background dispatch (queue).
ALTER TABLE missions ADD COLUMN queued_for_run INTEGER NOT NULL DEFAULT 0;

-- Existing rows stay queued_for_run=0 (drafts) so they are not auto-dispatched by MissionQueueSync.
UPDATE missions SET queued_for_run = 0 WHERE queued_for_run IS NULL;
