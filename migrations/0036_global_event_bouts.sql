PRAGMA foreign_keys = ON;

-- Scheduled cards from official non-UFC promotion pages belong to the scouting
-- product, not the locked UFC bout/prediction pipeline. Keep them in a separate
-- table so calendar research can show real matchups without changing model inputs.
CREATE TABLE IF NOT EXISTS scout_event_bouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  bout_key TEXT NOT NULL,
  bout_order INTEGER,
  fighter_a_name TEXT NOT NULL,
  fighter_b_name TEXT NOT NULL,
  weight_class TEXT,
  discipline TEXT NOT NULL DEFAULT 'MMA',
  title_fight INTEGER NOT NULL DEFAULT 0 CHECK (title_fight IN (0,1)),
  status TEXT NOT NULL DEFAULT 'scheduled',
  source_url TEXT NOT NULL,
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id,bout_key),
  CHECK (lower(fighter_a_name) <> lower(fighter_b_name))
);

CREATE INDEX IF NOT EXISTS idx_scout_event_bouts_event_order
  ON scout_event_bouts(event_id,bout_order,id);
CREATE INDEX IF NOT EXISTS idx_scout_event_bouts_fighter_a
  ON scout_event_bouts(fighter_a_name);
CREATE INDEX IF NOT EXISTS idx_scout_event_bouts_fighter_b
  ON scout_event_bouts(fighter_b_name);
