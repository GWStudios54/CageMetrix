-- Preserve every legacy snapshot and ID while allowing immutable source revisions.
PRAGMA foreign_keys=ON;
DROP VIEW IF EXISTS latest_ratings;
CREATE TABLE ratings_history_v3 (
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
  snapshot_key TEXT NOT NULL DEFAULT 'legacy',
  UNIQUE (fighter_id, model_version_id, as_of_date, weight_class, snapshot_key)
);
INSERT INTO ratings_history_v3 (id,fighter_id,model_version_id,as_of_date,weight_class,cmr,striking_offense,striking_defense,wrestling_offense,wrestling_defense,grappling,durability,pace,finishing,strength_of_schedule,recent_form,competitive_rating,technical_rating,resume_rating,confidence,sample_bouts,sample_minutes,components_json,created_at) SELECT id,fighter_id,model_version_id,as_of_date,weight_class,cmr,striking_offense,striking_defense,wrestling_offense,wrestling_defense,grappling,durability,pace,finishing,strength_of_schedule,recent_form,competitive_rating,technical_rating,resume_rating,confidence,sample_bouts,sample_minutes,components_json,created_at FROM ratings_history;
DROP TABLE ratings_history;
ALTER TABLE ratings_history_v3 RENAME TO ratings_history;
CREATE INDEX IF NOT EXISTS idx_ratings_fighter_date ON ratings_history(fighter_id, as_of_date DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_cmr ON ratings_history(cmr DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_weight_class ON ratings_history(weight_class, cmr DESC);
CREATE INDEX idx_ratings_model_fighter_date ON ratings_history(model_version_id,fighter_id,as_of_date DESC,id DESC);
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
ALTER TABLE bout_totals ADD COLUMN result TEXT CHECK (result IN ('W','L','D','NC'));
CREATE INDEX idx_rating_runs_source ON rating_runs(source_key);
