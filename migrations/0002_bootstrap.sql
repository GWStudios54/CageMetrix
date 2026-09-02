PRAGMA foreign_keys = ON;

ALTER TABLE fighters ADD COLUMN last_fight_date TEXT;
ALTER TABLE fighters ADD COLUMN ufc_bouts INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_fighters_last_fight ON fighters(last_fight_date DESC);

CREATE TABLE IF NOT EXISTS bootstrap_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fighter_source_ids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT,
  external_url TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fighter_id, provider),
  UNIQUE (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_fighter_source_provider ON fighter_source_ids(provider, external_id);

CREATE TABLE IF NOT EXISTS bout_totals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER REFERENCES bouts(id) ON DELETE CASCADE,
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  opponent_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  event_date TEXT NOT NULL,
  weight_class TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  won REAL NOT NULL CHECK (won BETWEEN 0 AND 1),
  knockdowns INTEGER NOT NULL DEFAULT 0,
  sig_strikes_landed INTEGER NOT NULL DEFAULT 0,
  sig_strikes_attempted INTEGER NOT NULL DEFAULT 0,
  sig_strikes_absorbed INTEGER NOT NULL DEFAULT 0,
  sig_strikes_faced INTEGER NOT NULL DEFAULT 0,
  total_strikes_landed INTEGER NOT NULL DEFAULT 0,
  total_strikes_attempted INTEGER NOT NULL DEFAULT 0,
  takedowns_landed INTEGER NOT NULL DEFAULT 0,
  takedowns_attempted INTEGER NOT NULL DEFAULT 0,
  takedowns_allowed INTEGER NOT NULL DEFAULT 0,
  takedowns_faced INTEGER NOT NULL DEFAULT 0,
  submission_attempts INTEGER NOT NULL DEFAULT 0,
  control_seconds INTEGER NOT NULL DEFAULT 0,
  opponent_control_seconds INTEGER NOT NULL DEFAULT 0,
  finish INTEGER NOT NULL DEFAULT 0 CHECK (finish IN (0, 1)),
  source_name TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_key, fighter_id)
);

CREATE INDEX IF NOT EXISTS idx_bout_totals_fighter_date ON bout_totals(fighter_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_bout_totals_opponent_date ON bout_totals(opponent_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_bout_totals_weight_class ON bout_totals(weight_class, event_date DESC);

CREATE TABLE IF NOT EXISTS rating_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_version_id INTEGER NOT NULL REFERENCES model_versions(id),
  source_key TEXT NOT NULL,
  source_max_date TEXT,
  fighters_scored INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  notes TEXT
);
