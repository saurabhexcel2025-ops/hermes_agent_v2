-- Profiles, skills SoT, mission tool hints, and removal of legacy tool_plugins (v2 -> v3).
-- Fresh installs use 001_baseline.sql at schema_version 3 and skip this file.

DROP TABLE IF EXISTS tool_plugins;

ALTER TABLE agent_profiles ADD COLUMN user_md TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_profiles ADD COLUMN memory_md TEXT NOT NULL DEFAULT '';
ALTER TABLE agent_profiles ADD COLUMN disabled_skills TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_profiles ADD COLUMN platform_toolsets TEXT NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_slug_lower
  ON agent_profiles(lower(slug));

CREATE TABLE IF NOT EXISTS agent_root (
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  display_name        TEXT NOT NULL DEFAULT 'Bob',
  description         TEXT NOT NULL DEFAULT '',
  personality         TEXT NOT NULL DEFAULT 'technical',
  config_yaml         TEXT NOT NULL DEFAULT '',
  soul_md             TEXT NOT NULL DEFAULT '',
  agents_md           TEXT NOT NULL DEFAULT '',
  hermes_md           TEXT NOT NULL DEFAULT '',
  user_md             TEXT NOT NULL DEFAULT '',
  memory_md           TEXT NOT NULL DEFAULT '',
  disabled_skills     TEXT NOT NULL DEFAULT '[]',
  platform_toolsets   TEXT NOT NULL DEFAULT '{}',
  synced_at           TEXT,
  sync_error          TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO agent_root (id, display_name, description)
VALUES (1, 'Bob', 'Local Hermes default agent at HERMES_HOME');

CREATE TABLE IF NOT EXISTS skills (
  skill_key       TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'custom',
  synced_at       TEXT,
  sync_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);

ALTER TABLE missions ADD COLUMN suggested_toolsets TEXT NOT NULL DEFAULT '[]';

ALTER TABLE catalog_templates ADD COLUMN suggested_toolsets TEXT NOT NULL DEFAULT '[]';
