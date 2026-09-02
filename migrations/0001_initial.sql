PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS fighters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  dob TEXT,
  height_cm REAL,
  reach_cm REAL,
  stance TEXT,
  nationality TEXT,
  current_weight_class TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fighters_name ON fighters(name);
CREATE INDEX IF NOT EXISTS idx_fighters_weight_class ON fighters(current_weight_class, active);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promotion TEXT NOT NULL DEFAULT 'UFC',
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  venue TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_promotion ON events(promotion, event_date DESC);

CREATE TABLE IF NOT EXISTS bouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  bout_order INTEGER,
  fighter_a_id INTEGER NOT NULL REFERENCES fighters(id),
  fighter_b_id INTEGER NOT NULL REFERENCES fighters(id),
  weight_class TEXT NOT NULL,
  scheduled_rounds INTEGER NOT NULL DEFAULT 3,
  title_fight INTEGER NOT NULL DEFAULT 0 CHECK (title_fight IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'scheduled',
  winner_id INTEGER REFERENCES fighters(id),
  result_method TEXT,
  result_detail TEXT,
  result_round INTEGER,
  result_time_seconds INTEGER,
  referee TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (fighter_a_id <> fighter_b_id),
  CHECK (winner_id IS NULL OR winner_id = fighter_a_id OR winner_id = fighter_b_id)
);

CREATE INDEX IF NOT EXISTS idx_bouts_event ON bouts(event_id, bout_order);
CREATE INDEX IF NOT EXISTS idx_bouts_fighter_a ON bouts(fighter_a_id);
CREATE INDEX IF NOT EXISTS idx_bouts_fighter_b ON bouts(fighter_b_id);
CREATE INDEX IF NOT EXISTS idx_bouts_weight_class ON bouts(weight_class);

CREATE TABLE IF NOT EXISTS round_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  fighter_id INTEGER NOT NULL REFERENCES fighters(id),
  round INTEGER NOT NULL,
  knockdowns INTEGER NOT NULL DEFAULT 0,
  sig_strikes_landed INTEGER NOT NULL DEFAULT 0,
  sig_strikes_attempted INTEGER NOT NULL DEFAULT 0,
  total_strikes_landed INTEGER NOT NULL DEFAULT 0,
  total_strikes_attempted INTEGER NOT NULL DEFAULT 0,
  head_landed INTEGER NOT NULL DEFAULT 0,
  head_attempted INTEGER NOT NULL DEFAULT 0,
  body_landed INTEGER NOT NULL DEFAULT 0,
  body_attempted INTEGER NOT NULL DEFAULT 0,
  leg_landed INTEGER NOT NULL DEFAULT 0,
  leg_attempted INTEGER NOT NULL DEFAULT 0,
  distance_landed INTEGER NOT NULL DEFAULT 0,
  distance_attempted INTEGER NOT NULL DEFAULT 0,
  clinch_landed INTEGER NOT NULL DEFAULT 0,
  clinch_attempted INTEGER NOT NULL DEFAULT 0,
  ground_landed INTEGER NOT NULL DEFAULT 0,
  ground_attempted INTEGER NOT NULL DEFAULT 0,
  takedowns_landed INTEGER NOT NULL DEFAULT 0,
  takedowns_attempted INTEGER NOT NULL DEFAULT 0,
  submission_attempts INTEGER NOT NULL DEFAULT 0,
  reversals INTEGER NOT NULL DEFAULT 0,
  control_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bout_id, fighter_id, round)
);

CREATE INDEX IF NOT EXISTS idx_round_stats_fighter ON round_stats(fighter_id, bout_id);
CREATE INDEX IF NOT EXISTS idx_round_stats_bout_round ON round_stats(bout_id, round);

CREATE TABLE IF NOT EXISTS model_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'rating',
  status TEXT NOT NULL DEFAULT 'development',
  description TEXT,
  parameters_json TEXT,
  training_window_start TEXT,
  training_window_end TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS ratings_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fighter_id INTEGER NOT NULL REFERENCES fighters(id) ON DELETE CASCADE,
  model_version_id INTEGER NOT NULL REFERENCES model_versions(id),
  as_of_date TEXT NOT NULL,
  weight_class TEXT,
  cmr REAL NOT NULL CHECK (cmr >= 0 AND cmr <= 100),
  striking_offense REAL CHECK (striking_offense BETWEEN 0 AND 100),
  striking_defense REAL CHECK (striking_defense BETWEEN 0 AND 100),
  wrestling_offense REAL CHECK (wrestling_offense BETWEEN 0 AND 100),
  wrestling_defense REAL CHECK (wrestling_defense BETWEEN 0 AND 100),
  grappling REAL CHECK (grappling BETWEEN 0 AND 100),
  durability REAL CHECK (durability BETWEEN 0 AND 100),
  pace REAL CHECK (pace BETWEEN 0 AND 100),
  finishing REAL CHECK (finishing BETWEEN 0 AND 100),
  strength_of_schedule REAL CHECK (strength_of_schedule BETWEEN 0 AND 100),
  recent_form REAL CHECK (recent_form BETWEEN 0 AND 100),
  competitive_rating REAL,
  technical_rating REAL,
  resume_rating REAL,
  confidence REAL NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  sample_bouts INTEGER NOT NULL DEFAULT 0,
  sample_minutes REAL NOT NULL DEFAULT 0,
  components_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fighter_id, model_version_id, as_of_date, weight_class)
);

CREATE INDEX IF NOT EXISTS idx_ratings_fighter_date ON ratings_history(fighter_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_cmr ON ratings_history(cmr DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_weight_class ON ratings_history(weight_class, cmr DESC);

CREATE VIEW IF NOT EXISTS latest_ratings AS
SELECT rh.*
FROM ratings_history rh
WHERE rh.id = (
  SELECT rh2.id
  FROM ratings_history rh2
  WHERE rh2.fighter_id = rh.fighter_id
  ORDER BY rh2.as_of_date DESC, rh2.created_at DESC, rh2.id DESC
  LIMIT 1
);

CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  model_version_id INTEGER NOT NULL REFERENCES model_versions(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at TEXT,
  fighter_a_probability REAL NOT NULL CHECK (fighter_a_probability BETWEEN 0 AND 1),
  fighter_b_probability REAL NOT NULL CHECK (fighter_b_probability BETWEEN 0 AND 1),
  confidence REAL CHECK (confidence BETWEEN 0 AND 100),
  top_factors_json TEXT,
  context_adjusted INTEGER NOT NULL DEFAULT 0 CHECK (context_adjusted IN (0, 1)),
  notes TEXT,
  UNIQUE (bout_id, model_version_id, context_adjusted)
);

CREATE INDEX IF NOT EXISTS idx_predictions_bout ON predictions(bout_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_model ON predictions(model_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fight_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bout_id INTEGER NOT NULL REFERENCES bouts(id) ON DELETE CASCADE,
  fighter_id INTEGER REFERENCES fighters(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  headline TEXT NOT NULL,
  note TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TEXT,
  retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confidence REAL CHECK (confidence BETWEEN 0 AND 100),
  included_in_model INTEGER NOT NULL DEFAULT 0 CHECK (included_in_model IN (0, 1)),
  UNIQUE (bout_id, fighter_id, source_url)
);

CREATE INDEX IF NOT EXISTS idx_context_bout ON fight_context(bout_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_fighter ON fight_context(fighter_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_context_category ON fight_context(category, published_at DESC);

CREATE TABLE IF NOT EXISTS source_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  value_text TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  observed_at TEXT,
  retrieved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_hash TEXT,
  UNIQUE (entity_type, entity_id, field_name, source_url, retrieved_at)
);

CREATE INDEX IF NOT EXISTS idx_source_entity ON source_observations(entity_type, entity_id, field_name);
CREATE INDEX IF NOT EXISTS idx_source_name ON source_observations(source_name, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS data_import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT
);

INSERT OR IGNORE INTO model_versions (
  name,
  version,
  kind,
  status,
  description
) VALUES (
  'CageMetrix Rating',
  '0.1.0',
  'rating',
  'development',
  'Initial schema placeholder for the opponent-adjusted CageMetrix rating model.'
);
